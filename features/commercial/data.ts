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

export interface PlanRowWithCounts extends PlanRow {
  feature_count: number;
  subscriber_count: number;
}

/** Lista todos os planos (RLS: MASTER vê todos, incluindo inativos — qualquer outro `authenticated` só veria os ativos, mas esta função só é chamada sob o gate de `/master`). */
export async function listPlans(): Promise<PlanRowWithCounts[]> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("plans")
    .select("id, slug, name, description, monthly_price, yearly_price, trial_days, is_active, is_featured, sort_order, plan_features(count), subscriptions(count)")
    .order("sort_order", { ascending: true });

  return ((data ?? []) as unknown as (PlanRow & { plan_features: { count: number }[]; subscriptions: { count: number }[] })[]).map(
    (p) => ({
      ...p,
      feature_count: p.plan_features?.[0]?.count ?? 0,
      subscriber_count: p.subscriptions?.[0]?.count ?? 0,
    }),
  );
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
