import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export interface OnboardingTenant {
  id: string;
  name: string;
  segment: string | null;
  description: string | null;
  instagram_handle: string | null;
  whatsapp_phone: string | null;
  contact_email: string | null;
  onboarding_completed_at: string | null;
}

interface MembershipRow {
  role: { key: string } | { key: string }[] | null;
  tenant: OnboardingTenant | OnboardingTenant[] | null;
}

function first<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

/**
 * Resolve o tenant do onboarding do usuário autenticado — nunca a partir
 * de um tenant_id vindo do client (query param, campo oculto de
 * formulário), sempre a partir da sessão + tenant_members, a mesma tabela
 * que a RLS já usa para autorizar (arquitetura §24 Etapa 4: "nunca
 * confiar tenant_id/user_id/role vindo do client").
 *
 * `onboardingPending`:
 *   - true  → só tenants com onboarding_completed_at IS NULL (para /onboarding)
 *   - false → só tenants com onboarding_completed_at IS NOT NULL (para /painel)
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: memberships } = await supabase
    .from("tenant_members")
    .select(
      "role:roles(key), tenant:tenants(id, name, segment, description, instagram_handle, whatsapp_phone, contact_email, onboarding_completed_at)",
    )
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  for (const row of (memberships ?? []) as unknown as MembershipRow[]) {
    const role = first(row.role);
    const tenant = first(row.tenant);
    if (role?.key !== "OWNER" || !tenant) continue;
    const completed = tenant.onboarding_completed_at !== null;
    if (onboardingPending ? !completed : completed) return tenant;
  }

  return null;
}
