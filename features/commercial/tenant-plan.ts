import "server-only";

import { cache } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface TenantCommercialContext {
  /** ACTIVE | TRIALING | EXPIRED | SUSPENDED | CANCELLED — mesmo vocabulário de tenant_access_status(). */
  status: string;
  planSlug: string | null;
  planName: string | null;
  /** `features.key` liberadas pelo plano atual (join de plan_features, mesma fonte de tenant_has_feature). */
  features: Set<string>;
  limits: {
    productsLimit: number | null;
    categoriesLimit: number | null;
  };
}

interface PlanFeatureRow {
  features: { key: string } | { key: string }[] | null;
}

function featureKey(row: PlanFeatureRow["features"]): string | null {
  const f = Array.isArray(row) ? row[0] : row;
  return f?.key ?? null;
}

/**
 * Camada de domínio única para "qual o plano/status/features/limites deste
 * tenant" (prompt Etapa 16 §12: "sem duplicar lógica espalhada pelas
 * páginas"). Reaproveita as mesmas fontes oficiais já existentes —
 * `tenant_access_status`/`tenant_plan_limit` (RPCs, Etapa 14) e a mesma
 * junção `plan_features → features` que `tenant_has_feature` usa
 * internamente — nunca reimplementa a lógica de autorização, só agrega o
 * resultado para consumo pela UI (sidebar, indicadores de uso).
 *
 * `cache()` por request, mesmo padrão de `getCurrentMembership`.
 */
export const getTenantCommercialContext = cache(
  async (tenantId: string): Promise<TenantCommercialContext> => {
    const supabase = await createSupabaseServerClient();

    const [statusRes, subscriptionRes, productsLimitRes, categoriesLimitRes] = await Promise.all([
      supabase.rpc("tenant_access_status", { p_tenant_id: tenantId }),
      supabase
        .from("subscriptions")
        .select("plan_id, plans(slug, name)")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      supabase.rpc("tenant_plan_limit", { p_tenant_id: tenantId, p_limit_key: "products_limit" }),
      supabase.rpc("tenant_plan_limit", { p_tenant_id: tenantId, p_limit_key: "categories_limit" }),
    ]);

    const planRow = subscriptionRes.data?.plans as { slug: string; name: string } | { slug: string; name: string }[] | null;
    const plan = Array.isArray(planRow) ? planRow[0] : planRow;

    let features = new Set<string>();
    const planId = subscriptionRes.data?.plan_id as string | undefined;
    if (planId) {
      const { data: planFeatures } = await supabase
        .from("plan_features")
        .select("features(key)")
        .eq("plan_id", planId);
      features = new Set(
        ((planFeatures ?? []) as unknown as PlanFeatureRow[])
          .map((row) => featureKey(row.features))
          .filter((key): key is string => Boolean(key)),
      );
    }

    return {
      status: (statusRes.data as string | null) ?? "EXPIRED",
      planSlug: plan?.slug ?? null,
      planName: plan?.name ?? null,
      features,
      limits: {
        productsLimit: (productsLimitRes.data as number | null) ?? null,
        categoriesLimit: (categoriesLimitRes.data as number | null) ?? null,
      },
    };
  },
);

/** `true` só quando o plano libera explicitamente o recurso — nunca assume acesso na ausência de dado (mesmo princípio fail-closed de tenant_has_feature). */
export function hasFeature(context: TenantCommercialContext, featureKey: string): boolean {
  return context.features.has(featureKey);
}
