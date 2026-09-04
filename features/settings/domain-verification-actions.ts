"use server";

import { revalidatePath } from "next/cache";

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { createDomainChallenge, isDomainChallengeExpired } from "@/lib/security/domain-challenge";
import { buildChallengeRecordName, checkDomainChallengeTxt } from "@/lib/security/dns-verification";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * D17.3.2 — fluxo real de verificação de domínio (DNS TXT). Duas Server
 * Actions: `startDomainVerification` (gera o desafio) e
 * `checkDomainVerification` (consulta o DNS e decide o resultado).
 * Nenhuma UI/Host Routing/Vercel Domains é implementada aqui — só as
 * duas operações de servidor (ver relatório D17.3.2).
 */

const CONFIGURACOES_PATH = "/painel/configuracoes/dominio";

export interface StartDomainVerificationResult {
  success: boolean;
  error?: string;
  domainId?: string;
  domain?: string;
  verificationMethod?: "dns_txt";
  dnsRecordName?: string;
  /** Texto puro — só nesta resposta, uma única vez. Nunca persistido (D17.3.1: só o hash é gravado). */
  verificationToken?: string;
  expiresAt?: string;
}

export interface CheckDomainVerificationResult {
  success: boolean;
  error?: string;
  status?: "pending" | "verifying" | "active";
  verified?: boolean;
  expired?: boolean;
}

/** Mesmo checklist de sempre — cópia local, não compartilhada (mesmo padrão de domain-actions.ts/whatsapp/shipping/payments/checkout-actions.ts/pix-actions.ts). */
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
 * `tenant_domains` só tem RLS pública para `anon` (D17.1) — sem policy
 * de `authenticated`, então o único caminho para o lojista ler/escrever
 * os PRÓPRIOS domínios é `service_role`, sempre depois de
 * `resolveTenantAndPermission()` já ter decidido `tenantId` a partir da
 * sessão (mesmo padrão/justificativa de `features/settings/domain-actions.ts`).
 */
function domainsClient() {
  return createSupabaseServiceRoleClient();
}

interface DomainRow {
  id: string;
  domain: string;
  domain_type: "subdomain" | "custom";
  status: "pending" | "verifying" | "active";
}

/**
 * Busca o domínio SEMPRE com escopo de tenant (`id` + `tenant_id`
 * juntos, nunca só `id`) — um `domainId` de outro tenant simplesmente não
 * é encontrado (0 rows), nunca revela se a linha existe para outro
 * tenant. `service_role` bypassa RLS por completo, então este filtro é a
 * ÚNICA barreira de isolamento entre tenants nestas duas Actions —
 * diferente de D17.2 (onde `UNIQUE(domain)` no banco é a autoridade
 * final contra duplicidade), aqui não há constraint de banco equivalente
 * que impeça ler/escrever a linha errada; a garantia é inteiramente este
 * filtro de aplicação, testado explicitamente (ver testes de integração).
 */
async function findOwnedDomain(
  supabase: ReturnType<typeof domainsClient>,
  domainId: string,
  tenantId: string,
  columns: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await supabase.from("tenant_domains").select(columns).eq("id", domainId).eq("tenant_id", tenantId).maybeSingle();
  return data as Record<string, unknown> | null;
}

/**
 * Gera (ou rotaciona) o desafio de verificação de um domínio `custom` do
 * tenant atual. Transiciona sempre para `verifying`, mesmo se o domínio
 * já era `active` — chamar esta Action é sempre um pedido EXPLÍCITO do
 * lojista (nunca automático), então tratar `active → verifying` aqui é
 * uma revalidação intencional, não um downgrade silencioso (D17.3.0 §L,
 * ticket Etapa 5: "active → permitir nova verificação somente se isso
 * representar uma rotação/revalidação explícita e segura" — é
 * exatamente isso). Um challenge novo sempre substitui — nunca coexiste
 * com — qualquer challenge anterior (D17.3.0 §E, ticket Etapa 16): os 5
 * campos são escritos numa única operação `UPDATE`.
 */
export async function startDomainVerification(domainId: string): Promise<StartDomainVerificationResult> {
  if (typeof domainId !== "string" || domainId.length === 0) {
    return { success: false, error: "Domínio inválido." };
  }

  const resolved = await resolveTenantAndPermission();
  if ("error" in resolved) return { success: false, error: resolved.error };
  const { tenantId } = resolved;

  const supabase = domainsClient();

  const existing = (await findOwnedDomain(supabase, domainId, tenantId, "id, domain, domain_type, status")) as DomainRow | null;
  if (!existing) {
    return { success: false, error: "Domínio não encontrado." };
  }
  if (existing.domain_type !== "custom") {
    return { success: false, error: "Este domínio não pode ser verificado." };
  }

  const { token, record } = createDomainChallenge();

  // Única operação atômica: method + hash + started_at + expires_at +
  // status, todos no mesmo UPDATE — nunca campo a campo (ticket Etapa 6).
  // `last_verification_at` reiniciado para null: uma tentativa de
  // verificação de um challenge ANTERIOR não deve aparecer como "última
  // tentativa" do challenge novo.
  const { error } = await supabase
    .from("tenant_domains")
    .update({
      verification_method: record.verificationMethod,
      verification_token_hash: record.verificationTokenHash,
      verification_started_at: record.verificationStartedAt.toISOString(),
      verification_expires_at: record.verificationExpiresAt.toISOString(),
      last_verification_at: null,
      status: "verifying",
    })
    .eq("id", domainId)
    .eq("tenant_id", tenantId);

  if (error) {
    return { success: false, error: "Não foi possível iniciar a verificação. Tente novamente." };
  }

  revalidatePath(CONFIGURACOES_PATH);

  return {
    success: true,
    domainId,
    domain: existing.domain,
    verificationMethod: record.verificationMethod,
    dnsRecordName: buildChallengeRecordName(existing.domain),
    verificationToken: token,
    expiresAt: record.verificationExpiresAt.toISOString(),
  };
}

/**
 * Consulta o DNS TXT real e decide o resultado. Idempotente (ticket
 * Etapa 18): um domínio já `active` retorna o mesmo resultado sem tocar
 * em nada (nunca gera novo challenge, nunca faz downgrade). Um challenge
 * expirado volta para `pending` sem gerar um novo automaticamente
 * (D17.3.0 §F / ticket Etapa 15) — o lojista precisa chamar
 * `startDomainVerification` de novo, de propósito.
 */
export async function checkDomainVerification(domainId: string): Promise<CheckDomainVerificationResult> {
  if (typeof domainId !== "string" || domainId.length === 0) {
    return { success: false, error: "Domínio inválido." };
  }

  const resolved = await resolveTenantAndPermission();
  if ("error" in resolved) return { success: false, error: resolved.error };
  const { tenantId } = resolved;

  const supabase = domainsClient();

  const existing = await findOwnedDomain(
    supabase,
    domainId,
    tenantId,
    "id, domain, domain_type, status, verification_token_hash, verification_started_at, verification_expires_at",
  );
  if (!existing) {
    return { success: false, error: "Domínio não encontrado." };
  }
  if (existing.domain_type !== "custom") {
    return { success: false, error: "Este domínio não pode ser verificado." };
  }

  const status = existing.status as "pending" | "verifying" | "active";

  // Idempotência: já active nunca sofre downgrade num check normal.
  if (status === "active") {
    return { success: true, status: "active", verified: true, expired: false };
  }

  const tokenHash = existing.verification_token_hash as string | null;
  const startedAt = existing.verification_started_at as string | null;
  const expiresAtRaw = existing.verification_expires_at as string | null;

  if (!tokenHash || !startedAt || !expiresAtRaw) {
    // Nenhum challenge ativo (ex.: pending que nunca chamou
    // startDomainVerification) — nada a verificar.
    return { success: true, status, verified: false, expired: false };
  }

  const expiresAt = new Date(expiresAtRaw);
  if (isDomainChallengeExpired(expiresAt)) {
    const { error } = await supabase
      .from("tenant_domains")
      .update({ status: "pending", last_verification_at: new Date().toISOString() })
      .eq("id", domainId)
      .eq("tenant_id", tenantId);
    if (error) {
      return { success: false, error: "Não foi possível verificar o domínio agora. Tente novamente." };
    }
    revalidatePath(CONFIGURACOES_PATH);
    return { success: true, status: "pending", verified: false, expired: true };
  }

  const dnsResult = await checkDomainChallengeTxt(existing.domain as string, tokenHash);
  const now = new Date().toISOString();

  if (dnsResult.outcome === "match") {
    const { error } = await supabase
      .from("tenant_domains")
      .update({ status: "active", verified_at: now, last_verification_at: now })
      .eq("id", domainId)
      .eq("tenant_id", tenantId);
    if (error) {
      return { success: false, error: "Não foi possível ativar o domínio agora. Tente novamente." };
    }
    revalidatePath(CONFIGURACOES_PATH);
    return { success: true, status: "active", verified: true, expired: false };
  }

  if (dnsResult.outcome === "error") {
    // Log mínimo e seguro: nunca o token/hash/conteúdo do TXT, só o
    // suficiente para diagnosticar (mesmo padrão de D16.2).
    console.error("[domain-verification] dns lookup failed", { tenantId, domainId, reason: dnsResult.reason });
  }

  // not_found / no_match / error: continua verifying, só registra a
  // tentativa — nunca deriva/expõe o motivo técnico exato ao cliente.
  await supabase.from("tenant_domains").update({ last_verification_at: now }).eq("id", domainId).eq("tenant_id", tenantId);

  return { success: true, status: "verifying", verified: false, expired: false };
}
