import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface PlanRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  monthly_price: number | null;
  yearly_price: number | null;
  trial_days: number;
  is_active: boolean;
  is_featured: boolean;
  sort_order: number;
}

/** Quebra real de lojas por status comercial (Etapa 20 §1/§6) — nunca mockada, sempre derivada de `subscriptions`/`tenants` ao vivo (sem tabela de cache/contador duplicado). */
export interface PlanStoreCounts {
  total: number;
  trialing: number;
  active: number;
  suspended: number;
}

export interface PlanRowWithCounts extends PlanRow {
  feature_count: number;
  subscriber_count: number;
  storeCounts: PlanStoreCounts;
}

function emptyStoreCounts(): PlanStoreCounts {
  return { total: 0, trialing: 0, active: 0, suspended: 0 };
}

/**
 * Classifica uma subscription num dos 3 baldes exibidos no Master
 * (Etapa 20 §1/§6) — mesma prioridade de `private.tenant_access_status`
 * (loja suspensa pelo MASTER, Etapa 18, sempre vence sobre o status da
 * subscription): não reimplementa a função inteira (que exige contexto de
 * sessão/RPC por tenant), só a parte necessária para uma contagem
 * agregada de exibição. `past_due` conta como ativa, mesmo tratamento de
 * `tenant_access_status` (Etapa 3: sem bloqueio automático de cobrança
 * ainda).
 */
function bucketFor(subStatus: string, tenantStatus: string | undefined): "trialing" | "active" | "suspended" | null {
  if (tenantStatus === "suspended" || tenantStatus === "deleted" || subStatus === "suspended") return "suspended";
  if (subStatus === "trialing") return "trialing";
  if (subStatus === "active" || subStatus === "past_due") return "active";
  return null;
}

/** Lista todos os planos (RLS: MASTER vê todos, incluindo inativos — qualquer outro `authenticated` só veria os ativos, mas esta função só é chamada sob o gate de `/master`). */
export async function listPlans(): Promise<PlanRowWithCounts[]> {
  const supabase = await createSupabaseServerClient();

  const [{ data: plans }, { data: subs }] = await Promise.all([
    supabase
      .from("plans")
      .select("id, slug, name, description, monthly_price, yearly_price, trial_days, is_active, is_featured, sort_order, plan_features(count)")
      .order("sort_order", { ascending: true }),
    supabase.from("subscriptions").select("plan_id, status, tenants(status)"),
  ]);

  const countsByPlan = new Map<string, PlanStoreCounts>();
  for (const sub of (subs ?? []) as { plan_id: string; status: string; tenants: { status: string } | { status: string }[] | null }[]) {
    const tenantRow = Array.isArray(sub.tenants) ? sub.tenants[0] : sub.tenants;
    const counts = countsByPlan.get(sub.plan_id) ?? emptyStoreCounts();
    counts.total += 1;
    const bucket = bucketFor(sub.status, tenantRow?.status);
    if (bucket) counts[bucket] += 1;
    countsByPlan.set(sub.plan_id, counts);
  }

  return ((plans ?? []) as unknown as (PlanRow & { plan_features: { count: number }[] })[]).map((p) => {
    const storeCounts = countsByPlan.get(p.id) ?? emptyStoreCounts();
    return {
      ...p,
      feature_count: p.plan_features?.[0]?.count ?? 0,
      subscriber_count: storeCounts.total,
      storeCounts,
    };
  });
}

export interface FeatureRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string | null;
  is_active: boolean;
}

export async function listFeatures(): Promise<FeatureRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("features")
    .select("id, key, name, description, category, is_active")
    .order("category", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []) as FeatureRow[];
}

export interface PlanDetail extends PlanRow {
  featureIds: string[];
}

/** Plano + o conjunto de recursos já associados (para os checkboxes do prompt §19). */
export async function getPlanDetail(planId: string): Promise<PlanDetail | null> {
  const supabase = await createSupabaseServerClient();

  const { data: plan } = await supabase
    .from("plans")
    .select("id, slug, name, description, monthly_price, yearly_price, trial_days, is_active, is_featured, sort_order")
    .eq("id", planId)
    .maybeSingle();
  if (!plan) return null;

  const { data: planFeatures } = await supabase.from("plan_features").select("feature_id").eq("plan_id", planId);

  return { ...(plan as PlanRow), featureIds: (planFeatures ?? []).map((pf) => pf.feature_id as string) };
}

export interface PlanLimitRow {
  id: string;
  limit_key: string;
  limit_value: number;
}

/** Limites configurados para um plano (ajuste arquitetural — distinto de recursos, RLS MASTER-only). */
export async function listPlanLimits(planId: string): Promise<PlanLimitRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("plan_limits")
    .select("id, limit_key, limit_value")
    .eq("plan_id", planId)
    .order("limit_key", { ascending: true });
  return (data ?? []) as PlanLimitRow[];
}
