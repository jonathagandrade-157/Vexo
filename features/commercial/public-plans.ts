import "server-only";

import { cache } from "react";

import { createSupabasePublicClient } from "@/lib/supabase/server";

export interface PublicPlan {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  monthly_price: number | null;
  trial_days: number;
  is_featured: boolean;
  featureNames: string[];
}

interface PlanFeatureJoinRow {
  slug: string;
  name: string;
  description: string | null;
  monthly_price: number | null;
  trial_days: number;
  is_featured: boolean;
  sort_order: number;
  plan_features: { features: { name: string } | { name: string }[] | null }[];
}

/**
 * Planos ativos para a landing page pública (`/`) — usa o client anon,
 * nunca o autenticado (`features/commercial/data.ts`, escopado ao gate do
 * MASTER). A RLS que permite isto (`SELECT` para `anon` em `plans`/
 * `plan_features`/`features` quando `is_active`) já foi preparada na Etapa
 * 14 especificamente para este caso — ver
 * `docs/architecture/etapa-14-planos-features.md` §"Preparação para o
 * índice público". Nenhuma tabela/coluna nova, nenhum preço inventado:
 * planos sem `monthly_price` cadastrado mostram "A definir", nunca um
 * valor fictício.
 */
export const listPublicPlans = cache(async (): Promise<PublicPlan[]> => {
  const supabase = createSupabasePublicClient();
  const { data } = await supabase
    .from("plans")
    .select(
      "slug, name, description, monthly_price, trial_days, is_featured, sort_order, plan_features(features(name))",
    )
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  return ((data ?? []) as unknown as PlanFeatureJoinRow[]).map((plan) => ({
    id: plan.slug,
    slug: plan.slug,
    name: plan.name,
    description: plan.description,
    monthly_price: plan.monthly_price,
    trial_days: plan.trial_days,
    is_featured: plan.is_featured,
    featureNames: plan.plan_features
      .map((pf) => (Array.isArray(pf.features) ? pf.features[0]?.name : pf.features?.name))
      .filter((name): name is string => Boolean(name)),
  }));
});
