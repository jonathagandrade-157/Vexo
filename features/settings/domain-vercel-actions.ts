"use server";

import { revalidatePath } from "next/cache";

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import {
  addVercelDomain,
  getVercelDomain,
  getVercelDomainConfig,
  type VercelAddDomainResult,
  type VercelDomainConfigResult,
  type VercelDomainErrorCode,
  type VercelDomainInfo,
  type VercelDomainResult,
} from "@/lib/vercel/domains";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * D17.5.1 — binding do domínio customizado (já `active` no VEXO via DNS
 * TXT, D17.3) ao projeto Vercel (auditoria D17.5.0). Duas Server Actions:
 * `registerDomainOnVercel` (registra) e `checkVercelDomainStatus`
 * (reconsulta o estado, acionado pelo lojista — nunca polling automático).
 *
 * A Vercel nunca decide tenancy aqui: toda chamada só acontece depois que
 * `tenant_domains.status === 'active'` já foi confirmado no banco — a
 * mesma garantia de posse por DNS TXT que já protege o Host Routing
 * (D17.4) continua sendo a única fonte de autoridade sobre "quem é dono
 * deste domínio". O binding na Vercel é só infraestrutura por cima disso.
 */

const CONFIGURACOES_PATH = "/painel/configuracoes/dominio";

export type VercelDomainStatus = "not_registered" | "registering" | "registered" | "configuration_error" | "certificate_error" | "unknown";

export interface RegisterDomainOnVercelResult {
  success: boolean;
  error?: string;
  vercelDomainStatus?: VercelDomainStatus;
}

export interface CheckVercelDomainStatusResult {
  success: boolean;
  error?: string;
  vercelDomainStatus?: VercelDomainStatus;
}

/** Mesmo checklist de sempre — cópia local, não compartilhada (mesmo padrão de domain-actions.ts/domain-verification-actions.ts/whatsapp/shipping/payments/checkout-actions.ts/pix-actions.ts). `resolveActiveTenantForUser` já ignora tenants suspended/deleted (D8 Camada 1) — "tenant ativo obrigatório" já vem garantido daqui, sem lógica adicional. */
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

/** Mesmo raciocínio de domain-verification-actions.ts::domainsClient() — `tenant_domains` só tem RLS pública para `anon`, então `service_role` é o único caminho para o lojista ler/escrever os PRÓPRIOS domínios, sempre depois de `resolveTenantAndPermission()` já ter decidido `tenantId` a partir da sessão. */
function domainsClient() {
  return createSupabaseServiceRoleClient();
}

interface OwnedDomainRow {
  id: string;
  domain: string;
  domain_type: "subdomain" | "custom";
  status: "pending" | "verifying" | "active";
  vercel_registered_at: string | null;
}

/**
 * Nunca deixa a Server Action lançar por uma falha de configuração
 * (ex.: `VERCEL_API_TOKEN`/`VERCEL_PROJECT_ID`/`VERCEL_TEAM_ID` ausentes —
 * `getVercelEnv()` lança nesse caso, ticket Fase C) nem por qualquer outro
 * erro inesperado do wrapper — sempre um resultado categorizado, mesmo
 * princípio de "nunca lançar para o chamador" já aplicado em todo o
 * `lib/vercel/domains.ts`. A mensagem da exceção nunca contém o token
 * (só nomes de variável, por construção de `getVercelEnv()`), mas mesmo
 * assim nunca é repassada ao cliente — só logada.
 */
async function safeCallVercel<T extends VercelDomainResult | VercelAddDomainResult | VercelDomainConfigResult>(
  label: string,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (cause) {
    console.error(`[domain-vercel] ${label} falhou de forma inesperada (configuração ausente ou erro interno)`, {
      cause: cause instanceof Error ? cause.constructor.name : "unknown",
    });
    // Seguro: as 3 uniões aceitas por `T` compartilham exatamente esta
    // forma de falha (`{ok:false, code: VercelDomainErrorCode, ...}`,
    // "api_error" já é um `VercelDomainErrorCode` válido) — o cast só
    // existe porque TypeScript não infere isso automaticamente através
    // de um genérico com bound de união.
    return { ok: false, code: "api_error" } as T;
  }
}

/** Sempre `id` + `tenant_id` juntos — nunca só `id` (mesmo padrão de `findOwnedDomain` em domain-verification-actions.ts). `service_role` bypassa RLS por completo: este filtro é a ÚNICA barreira de isolamento entre tenants nestas duas Actions. */
async function findOwnedDomain(
  supabase: ReturnType<typeof domainsClient>,
  domainId: string,
  tenantId: string,
): Promise<OwnedDomainRow | null> {
  const { data } = await supabase
    .from("tenant_domains")
    .select("id, domain, domain_type, status, vercel_registered_at")
    .eq("id", domainId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data as OwnedDomainRow | null;
}

/** `registered_other_project`/`conflict` são problemas de configuração que o lojista precisa resolver (fora da Vercel ou do próprio VEXO) — nunca `unknown`, que é reservado para "não foi possível confirmar" (erro de rede/API/resposta inesperada). */
function mapErrorCodeToVercelDomainStatus(code: VercelDomainErrorCode): VercelDomainStatus {
  if (code === "registered_other_project" || code === "conflict") return "configuration_error";
  return "unknown";
}

/** Nunca a mensagem/código bruto da Vercel — só texto genérico e seguro, mesmo princípio de "nunca revelar detalhe técnico exato" já em uso em checkDomainVerification (D17.3.2) para erros de DNS. */
function mapErrorCodeToMessage(code: VercelDomainErrorCode): string {
  switch (code) {
    case "registered_other_project":
      return "Este domínio já está configurado em outro projeto. Libere-o no outro serviço antes de continuar.";
    case "rate_limited":
      return "Muitas tentativas em pouco tempo. Aguarde alguns instantes e tente novamente.";
    case "timeout":
    case "network_error":
      return "Não foi possível falar com a Vercel agora. Tente novamente em alguns instantes.";
    case "unauthorized":
    case "forbidden":
      return "Não foi possível concluir a configuração na Vercel agora. Tente novamente mais tarde.";
    default:
      return "Não foi possível concluir a configuração na Vercel agora. Tente novamente.";
  }
}

/**
 * Deriva o estado interno a partir do que a Vercel já confirmou sobre o
 * domínio: `verified=false` (POST/GET) significa que o domínio foi
 * aceito no projeto mas o DNS ainda não aponta pra Vercel — `registering`,
 * nunca `registered` (D17.5.0 §N: SSL só é provisionado depois de
 * `misconfigured=false`, que só é avaliado quando `verified=true`).
 *
 * Nota de escopo (registrada, não corrigida aqui): a API consultada não
 * expõe um campo separado para "erro de certificado" distinto de
 * `misconfigured` — `certificate_error` permanece um estado válido no
 * banco (migration 20260817220102) para uma etapa futura que encontre um
 * sinal mais granular, mas esta implementação nunca o produz sozinha.
 */
async function deriveVercelDomainStatus(domain: string, info: VercelDomainInfo): Promise<{ status: VercelDomainStatus; errorCode: string | null }> {
  if (!info.verified) {
    return { status: "registering", errorCode: null };
  }
  const configResult = await safeCallVercel("consulta de configuração", () => getVercelDomainConfig(domain));
  if (!configResult.ok) {
    return { status: "unknown", errorCode: configResult.code };
  }
  return { status: configResult.config.misconfigured ? "configuration_error" : "registered", errorCode: null };
}

/**
 * Registra (ou reconfirma, de forma idempotente) o domínio `custom` e já
 * `active` do tenant atual no projeto Vercel fixo do VEXO. Nunca chama a
 * Vercel para um domínio ainda `pending`/`verifying` — a posse por DNS TXT
 * é sempre a condição anterior, nunca o inverso (D17.5.0 §G).
 */
export async function registerDomainOnVercel(domainId: string): Promise<RegisterDomainOnVercelResult> {
  if (typeof domainId !== "string" || domainId.length === 0) {
    return { success: false, error: "Domínio inválido." };
  }

  const resolved = await resolveTenantAndPermission();
  if ("error" in resolved) return { success: false, error: resolved.error };
  const { tenantId } = resolved;

  const supabase = domainsClient();

  const existing = await findOwnedDomain(supabase, domainId, tenantId);
  if (!existing) {
    return { success: false, error: "Domínio não encontrado." };
  }
  if (existing.domain_type !== "custom") {
    return { success: false, error: "Este domínio não pode ser configurado na Vercel." };
  }
  if (existing.status !== "active") {
    return { success: false, error: "Verifique a posse do domínio (DNS TXT) antes de conectá-lo à Vercel." };
  }

  const now = new Date().toISOString();
  const result = await safeCallVercel("registro", () => addVercelDomain(existing.domain));

  if (!result.ok) {
    const vercelDomainStatus = mapErrorCodeToVercelDomainStatus(result.code);
    // Log seguro: só identificadores e o código categorizado — nunca token, nunca corpo bruto da API.
    console.error("[domain-vercel] registro falhou", { tenantId, domainId, code: result.code });
    await supabase
      .from("tenant_domains")
      .update({ vercel_domain_status: vercelDomainStatus, vercel_error_code: result.code, vercel_last_checked_at: now })
      .eq("id", domainId)
      .eq("tenant_id", tenantId);
    revalidatePath(CONFIGURACOES_PATH);
    return { success: false, error: mapErrorCodeToMessage(result.code), vercelDomainStatus };
  }

  console.log(result.alreadyRegistered ? "[domain-vercel] domínio já registrado" : "[domain-vercel] registro concluído", {
    tenantId,
    domainId,
  });

  const { status: vercelDomainStatus, errorCode } = await deriveVercelDomainStatus(existing.domain, result.domain);

  const updatePayload: Record<string, unknown> = {
    vercel_domain_status: vercelDomainStatus,
    vercel_error_code: errorCode,
    vercel_last_checked_at: now,
  };
  // Só grava na primeira vez que o binding é confirmado — nunca reescrito
  // por uma reconfirmação posterior (mesmo princípio de `verified_at`).
  if (vercelDomainStatus === "registered" && !existing.vercel_registered_at) {
    updatePayload.vercel_registered_at = now;
  }

  const { error } = await supabase.from("tenant_domains").update(updatePayload).eq("id", domainId).eq("tenant_id", tenantId);
  if (error) {
    return { success: false, error: "Domínio registrado na Vercel, mas não foi possível salvar o estado agora. Tente verificar novamente." };
  }

  revalidatePath(CONFIGURACOES_PATH);
  return { success: true, vercelDomainStatus };
}

/**
 * Reconsulta o estado do binding na Vercel — sempre acionado pelo
 * lojista pela UI (nunca polling automático, ticket Fase H). Exige
 * `tenant_domains.status === 'active'` da mesma forma que o registro.
 */
export async function checkVercelDomainStatus(domainId: string): Promise<CheckVercelDomainStatusResult> {
  if (typeof domainId !== "string" || domainId.length === 0) {
    return { success: false, error: "Domínio inválido." };
  }

  const resolved = await resolveTenantAndPermission();
  if ("error" in resolved) return { success: false, error: resolved.error };
  const { tenantId } = resolved;

  const supabase = domainsClient();

  const existing = await findOwnedDomain(supabase, domainId, tenantId);
  if (!existing) {
    return { success: false, error: "Domínio não encontrado." };
  }
  if (existing.domain_type !== "custom") {
    return { success: false, error: "Este domínio não pode ser configurado na Vercel." };
  }
  if (existing.status !== "active") {
    return { success: false, error: "Verifique a posse do domínio (DNS TXT) antes de conectá-lo à Vercel." };
  }

  const now = new Date().toISOString();
  const domainResult = await safeCallVercel("check", () => getVercelDomain(existing.domain));

  if (!domainResult.ok) {
    if (domainResult.code === "not_found") {
      console.log("[domain-vercel] check: domínio ainda não registrado", { tenantId, domainId });
      await supabase
        .from("tenant_domains")
        .update({ vercel_domain_status: "not_registered", vercel_error_code: null, vercel_last_checked_at: now })
        .eq("id", domainId)
        .eq("tenant_id", tenantId);
      revalidatePath(CONFIGURACOES_PATH);
      return { success: true, vercelDomainStatus: "not_registered" };
    }

    const vercelDomainStatus = mapErrorCodeToVercelDomainStatus(domainResult.code);
    console.error("[domain-vercel] check falhou", { tenantId, domainId, code: domainResult.code });
    await supabase
      .from("tenant_domains")
      .update({ vercel_domain_status: vercelDomainStatus, vercel_error_code: domainResult.code, vercel_last_checked_at: now })
      .eq("id", domainId)
      .eq("tenant_id", tenantId);
    revalidatePath(CONFIGURACOES_PATH);
    return { success: false, error: mapErrorCodeToMessage(domainResult.code), vercelDomainStatus };
  }

  console.log("[domain-vercel] check concluído", { tenantId, domainId });

  const { status: vercelDomainStatus, errorCode } = await deriveVercelDomainStatus(existing.domain, domainResult.domain);

  const updatePayload: Record<string, unknown> = {
    vercel_domain_status: vercelDomainStatus,
    vercel_error_code: errorCode,
    vercel_last_checked_at: now,
  };
  if (vercelDomainStatus === "registered" && !existing.vercel_registered_at) {
    updatePayload.vercel_registered_at = now;
  }

  const { error } = await supabase.from("tenant_domains").update(updatePayload).eq("id", domainId).eq("tenant_id", tenantId);
  if (error) {
    return { success: false, error: "Não foi possível salvar o estado agora. Tente novamente." };
  }

  revalidatePath(CONFIGURACOES_PATH);
  return { success: true, vercelDomainStatus };
}
