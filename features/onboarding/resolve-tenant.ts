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
  "id, name, slug, segment, description, instagram_handle, whatsapp_phone, contact_email, onboarding_completed_at, status, created_at";

/**
 * Consulta compartilhada — nunca a partir de um tenant_id vindo do client
 * (query param, campo oculto de formulário), sempre a partir da sessão +
 * tenant_members, a mesma tabela que a RLS já usa para autorizar
 * (arquitetura §24 Etapa 4 / §5 Etapa 5: "nunca confiar tenant_id/user_id/
 * role vindo do client"). `resolveOnboardingTenant` e
 * `resolveActiveTenantForUser` só decidem o que fazer com as linhas —
 * nenhuma duplica a query.
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

  return ((data ?? []) as unknown as MembershipRow[]).map((row) => ({
    role: first(row.role),
    tenant: first(row.tenant),
  }));
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
