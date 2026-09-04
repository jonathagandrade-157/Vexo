"use server";

import { revalidatePath } from "next/cache";

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { customDomainSchema, isReservedDomain, type CustomDomainInput, type DomainActionState } from "./domain-schema";

const CONFIGURACOES_PATH = "/painel/configuracoes/dominio";

export interface TenantDomainRow {
  id: string;
  domain: string;
  domainType: "subdomain" | "custom";
  isPrimary: boolean;
  status: "pending" | "verifying" | "active";
  verifiedAt: string | null;
  createdAt: string;
}

/** Mesmo checklist de sempre — cópia local, não compartilhada (mesmo padrão de whatsapp/shipping/payments/checkout-actions.ts/pix-actions.ts). */
async function resolveTenantAndPermission(): Promise<{ tenantId: string } | { error: string }> {
  const supabase = await createSupabaseServerClient();
  const membership = await resolveActiveTenantForUser(supabase);
  if (!membership || membership.tenant.onboarding_completed_at === null) {
    return { error: "Nenhuma loja configurada para esta conta." };
  }

  const { data: allowed } = await supabase.rpc("has_permission", {
    p_tenant_id: membership.tenant.id,
    p_permission_key: "settings.update",
  });
  if (!allowed) {
    return { error: "Você não tem permissão para gerenciar domínios desta loja." };
  }

  return { tenantId: membership.tenant.id };
}

/**
 * D17.1: `tenant_domains` só tem RLS pública para `anon`
 * (`status = 'active'`) — nenhuma policy para `authenticated`, de
 * propósito (a etapa que criou a tabela não implementou tela nenhuma
 * ainda, e esta etapa não altera essa RLS). Sem uma policy de
 * `authenticated` para o lojista ver/criar os PRÓPRIOS domínios
 * (inclusive os `pending`, que `anon` nunca vê), o único caminho hoje é
 * `service_role` — nunca para contornar autorização, só porque é o único
 * papel com SELECT/INSERT nesta tabela além de `anon`.
 * `resolveTenantAndPermission()` acima é sempre quem decide COM QUAL
 * `tenant_id` operar antes de qualquer chamada `service_role` chegar
 * aqui — nunca um `tenant_id` vindo de formulário/query/cookie.
 */
function domainsClient() {
  return createSupabaseServiceRoleClient();
}

/**
 * Lista os domínios do tenant atual. `tenantId` já deve ter sido
 * resolvido pelo chamador a partir da sessão (`getCurrentMembership()`,
 * mesmo padrão de `app/painel/configuracoes/page.tsx`) — esta função
 * nunca aceita um valor que possa ter vindo do client.
 */
export async function listTenantDomains(tenantId: string): Promise<TenantDomainRow[]> {
  const { data } = await domainsClient()
    .from("tenant_domains")
    .select("id, domain, domain_type, is_primary, status, verified_at, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });

  return (data ?? []).map((row) => ({
    id: row.id as string,
    domain: row.domain as string,
    domainType: row.domain_type as "subdomain" | "custom",
    isPrimary: row.is_primary as boolean,
    status: row.status as "pending" | "verifying" | "active",
    verifiedAt: row.verified_at as string | null,
    createdAt: row.created_at as string,
  }));
}

/**
 * Cadastra um domínio personalizado como `pending` — nunca `active`/
 * `verifying` (a transição real é D17.3, não implementada aqui). Nenhum
 * DNS/HTTP externo é consultado; `domain_type`/`status`/`verified_at`
 * nunca vêm de `formData` (o schema só aceita `domain`) — são sempre
 * valores fixos decididos aqui no servidor.
 */
export async function addCustomDomainAction(_prevState: DomainActionState, formData: FormData): Promise<DomainActionState> {
  const parsed = customDomainSchema.safeParse({ domain: formData.get("domain") });
  if (!parsed.success) {
    const fieldErrors: DomainActionState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof CustomDomainInput;
      fieldErrors[key] ??= issue.message;
    }
    return { status: "error", fieldErrors, message: "Verifique o domínio informado." };
  }
  const { domain } = parsed.data;

  if (isReservedDomain(domain)) {
    return { status: "error", message: "Este domínio pertence à própria VEXO e não pode ser cadastrado." };
  }

  const resolved = await resolveTenantAndPermission();
  if ("error" in resolved) return { status: "error", message: resolved.error };
  const { tenantId } = resolved;

  const supabase = domainsClient();

  // Checagem prévia só para uma mensagem melhor (mesmo domínio já
  // cadastrado por este tenant vs. já usado por outro) — nunca revela o
  // tenant_id do outro tenant, só se é "seu" ou "de terceiros". Nunca a
  // garantia final: UNIQUE(domain) no banco é quem realmente impede a
  // duplicidade, mesmo sob corrida entre este SELECT e o INSERT abaixo.
  const { data: existing } = await supabase.from("tenant_domains").select("tenant_id").eq("domain", domain).maybeSingle();
  if (existing) {
    if (existing.tenant_id === tenantId) {
      return { status: "error", message: "Este domínio já está cadastrado para a sua loja." };
    }
    return { status: "error", message: "Este domínio já está em uso." };
  }

  // Regra mínima de is_primary (D17.0 §K): o primeiro domínio customizado
  // do tenant vira primário, sem mecanismo de troca nesta etapa. Seguro
  // sob corrida: o índice único parcial `tenant_domains_one_primary_per_tenant`
  // (D17.1) é quem realmente impede dois primários do mesmo tenant, mesmo
  // que duas requisições concorrentes cheguem a esta contagem com o
  // mesmo resultado.
  const { count } = await supabase.from("tenant_domains").select("id", { count: "exact" }).eq("tenant_id", tenantId);
  const isPrimary = (count ?? 0) === 0;

  const { error } = await supabase.from("tenant_domains").insert({
    tenant_id: tenantId,
    domain,
    domain_type: "custom",
    is_primary: isPrimary,
    status: "pending",
  });

  if (error) {
    // Autoridade final contra a corrida SELECT→INSERT acima (dois
    // cadastros do mesmo domínio quase simultâneos): UNIQUE(domain)
    // rejeita o segundo INSERT mesmo que a checagem prévia não tenha
    // visto nada. `tenant_domains_domain_key` é o nome exato da
    // constraint (migration 20260817220100) — só esse conflito específico
    // vira a mensagem "já em uso"; qualquer outro erro (ex.: uma corrida
    // rara no índice parcial de is_primary) cai no genérico abaixo, nunca
    // ecoa a mensagem bruta do Postgres.
    if (error.code === "23505" && error.message.includes("tenant_domains_domain_key")) {
      return { status: "error", message: "Este domínio já está em uso." };
    }
    return { status: "error", message: "Não foi possível cadastrar o domínio. Tente novamente." };
  }

  revalidatePath(CONFIGURACOES_PATH);
  return { status: "success", message: "Domínio cadastrado. Ele fica pendente até a verificação (em uma etapa futura)." };
}
