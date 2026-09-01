import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export interface OnboardingTenant {
  id: string;
  name: string;
  slug: string;
  segment: string | null;
  description: string | null;
  instagram_handle: string | null;
  whatsapp_phone: string | null;
  contact_email: string | null;
  onboarding_completed_at: string | null;
  /** D12.2 — tipo de negócio (migration 20260817220093), null = tenant legado ou onboarding ainda não chegou à etapa "seu-negocio". */
  business_type: string | null;
  status: string;
  created_at: string;
}

export interface ActiveTenantMembership {
  tenant: OnboardingTenant;
  roleKey: string;
}

interface MembershipRow {
  role: { key: string } | { key: string }[] | null;
  tenant: OnboardingTenant | OnboardingTenant[] | null;
}

function first<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

const TENANT_COLUMNS =
  "id, name, slug, segment, description, instagram_handle, whatsapp_phone, contact_email, onboarding_completed_at, business_type, status, created_at";

/**
 * D8 (Camada 1) — `tenants.status` que impedem QUALQUER resolução de
 * membership ativa pelo lado do lojista (painel + onboarding + Server
 * Actions administrativas, todas via `activeMemberships()`). Escopo
 * deliberadamente estreito: só o campo bruto `tenants.status`, nunca
 * `tenant_access_status()` (que também cobre billing/trial — um bloqueio
 * comercial que esta etapa explicitamente não implementa). `pending`
 * nunca entra aqui — já funciona normalmente hoje (ex.: onboarding
 * concluído com a loja ainda pendente de aprovação) e a RLS pública do
 * storefront (migration 20260817220022) já usa exatamente esta mesma
 * lista, nunca `status = 'active'` sozinho.
 */
const BLOCKED_TENANT_STATUSES = new Set(["suspended", "deleted"]);

function isBlockedTenantStatus(status: string): boolean {
  return BLOCKED_TENANT_STATUSES.has(status);
}

/**
 * Consulta compartilhada — nunca a partir de um tenant_id vindo do client
 * (query param, campo oculto de formulário), sempre a partir da sessão +
 * tenant_members, a mesma tabela que a RLS já usa para autorizar
 * (arquitetura §24 Etapa 4 / §5 Etapa 5: "nunca confiar tenant_id/user_id/
 * role vindo do client"). `resolveOnboardingTenant` e
 * `resolveActiveTenantForUser` só decidem o que fazer com as linhas —
 * nenhuma duplica a query.
 *
 * D8 (Camada 1) — filtra tenant suspenso/deletado AQUI, uma vez só: nem
 * `resolveOnboardingTenant` nem `resolveActiveTenantForUser` (nem, por
 * tabela, nenhuma das ~18 Server Actions que dependem desta última através
 * de `getCurrentMembership()`) voltam a enxergar essa linha — sem precisar
 * tocar em nenhuma delas individualmente. Filtro em memória sobre o
 * resultado já trazido pela query (a coluna `status` já fazia parte de
 * `TENANT_COLUMNS`), nunca uma nova query nem mudança de RLS.
 */
async function activeMemberships(
  supabase: SupabaseClient,
): Promise<{ role: { key: string } | null; tenant: OnboardingTenant | null }[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("tenant_members")
    .select(`role:roles(key), tenant:tenants(${TENANT_COLUMNS})`)
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (error) {
    // TEMP DIAGNOSTIC LOG — remove after investigation. No PII.
    console.log("ACTIVE_MEMBERSHIPS_ERROR", { code: error.code, message: error.message });
    return [];
  }

  return ((data ?? []) as unknown as MembershipRow[])
    .map((row) => ({
      role: first(row.role),
      tenant: first(row.tenant),
    }))
    .filter(({ tenant }) => !tenant || !isBlockedTenantStatus(tenant.status));
}

/**
 * D8 (Camada 1) — UX apenas: `activeMemberships()` já filtra tenant
 * suspenso/deletado antes de qualquer decisão de autorização, então quem
 * chama `resolveActiveTenantForUser` nunca sabe a diferença entre "sem
 * tenant nenhum" e "tenant existe, mas está bloqueado". Esta função separada
 * refaz a mesma consulta, sem o filtro, só para o gate do painel poder
 * mostrar uma mensagem específica em vez do "sem loja" genérico — nunca é
 * usada para autorizar nada (nenhuma Server Action a chama).
 */
export async function getBlockedTenantStatus(supabase: SupabaseClient): Promise<"suspended" | "deleted" | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("tenant_members")
    .select(`tenant:tenants(status)`)
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (error) return null;

  for (const row of (data ?? []) as unknown as { tenant: { status: string } | { status: string }[] | null }[]) {
    const tenant = first(row.tenant);
    if (tenant?.status === "suspended" || tenant?.status === "deleted") return tenant.status;
  }
  return null;
}

/**
 * `onboardingPending`:
 *   - true  → só tenants com onboarding_completed_at IS NULL (para /onboarding)
 *   - false → só tenants com onboarding_completed_at IS NOT NULL
 *
 * Restrito a papel OWNER — só quem criou o tenant (Etapa 3) completa o
 * onboarding dele; ver `resolveActiveTenantForUser` para "qualquer membro
 * ativo", usado pelo gate do painel (Etapa 5), que precisa reconhecer
 * ADMIN/MANAGER/OPERATOR/SUPPORT também.
 *
 * Um usuário só teria mais de um tenant OWNER fora do fluxo atual (Etapa 3
 * cria exatamente um por cadastro) — se isso mudar em etapa futura, a
 * ordenação por `tenant_members.created_at` decide de forma determinística;
 * documentado aqui como limitação conhecida, não resolvido "por completo"
 * sem necessidade real ainda.
 */
export async function resolveOnboardingTenant(
  supabase: SupabaseClient,
  onboardingPending: boolean,
): Promise<OnboardingTenant | null> {
  const memberships = await activeMemberships(supabase);
  for (const { role, tenant } of memberships) {
    if (role?.key !== "OWNER" || !tenant) continue;
    const completed = tenant.onboarding_completed_at !== null;
    if (onboardingPending ? !completed : completed) return tenant;
  }
  return null;
}

/**
 * Resolve a primeira membership ativa do usuário, em QUALQUER papel — usada
 * pelo gate do `/painel` (Etapa 5, arquitetura §9): o painel precisa
 * reconhecer ADMIN/MANAGER/OPERATOR/SUPPORT, não só o OWNER que passou
 * pelo onboarding. Quem decide o que fazer com `onboarding_completed_at`/
 * `roleKey` (redirecionar, bloquear, mostrar estado informativo) é sempre
 * o chamador — esta função só resolve "a que tenant este usuário pertence
 * e com qual papel", nunca uma decisão de autorização por si só.
 */
export async function resolveActiveTenantForUser(
  supabase: SupabaseClient,
): Promise<ActiveTenantMembership | null> {
  const memberships = await activeMemberships(supabase);
  for (const { role, tenant } of memberships) {
    if (!role?.key || !tenant) continue;
    return { tenant, roleKey: role.key };
  }
  return null;
}
