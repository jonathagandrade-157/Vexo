import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface MasterDashboardStats {
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
  activeTrials: number;
  totalPlans: number;
  totalSubscriptions: number;
}

/**
 * Dados reais, sem MRR inventado (prompt Etapa 14 §16: "não inventar MRR
 * real" — cobrança não existe ainda). Todas as consultas já são
 * permitidas por RLS a um platform admin (`is_platform_admin()` nas
 * policies de `tenants`/`trial_records`/`plans`/`subscriptions`, Etapas
 * 2/3/14) — nenhuma policy nova precisou ser criada para este dashboard.
 */
export async function getMasterDashboardStats(): Promise<MasterDashboardStats> {
  const supabase = await createSupabaseServerClient();

  const [tenantsTotal, tenantsActive, tenantsSuspended, trialsActive, plansTotal, subscriptionsTotal] = await Promise.all([
    supabase.from("tenants").select("id", { count: "exact", head: true }),
    supabase.from("tenants").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("tenants").select("id", { count: "exact", head: true }).eq("status", "suspended"),
    supabase.from("trial_records").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("plans").select("id", { count: "exact", head: true }),
    supabase.from("subscriptions").select("id", { count: "exact", head: true }),
  ]);

  return {
    totalTenants: tenantsTotal.count ?? 0,
    activeTenants: tenantsActive.count ?? 0,
    suspendedTenants: tenantsSuspended.count ?? 0,
    activeTrials: trialsActive.count ?? 0,
    totalPlans: plansTotal.count ?? 0,
    totalSubscriptions: subscriptionsTotal.count ?? 0,
  };
}
