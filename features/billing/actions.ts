"use server";

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { getBillingGateway } from "@/lib/billing/registry";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { startBillingSubscription } from "./start-subscription";
import { type StartBillingSubscriptionActionState } from "./schema";

/**
 * Etapa 20.2.6 — wrapper fino de Server Action: só resolve sessão/tenant/
 * permissão e delega toda a lógica para `startBillingSubscription`
 * (testável isoladamente, sem passar por este arquivo `"use server"`).
 *
 * PENDÊNCIA: `private.has_permission(tenantId, 'billing.manage')` só
 * retorna `true` depois que a permissão `billing.manage` existir no banco
 * (proposta no relatório da Etapa 20.2.6, ainda não criada/aplicada) — até
 * lá, esta Action nega todo mundo, propositalmente (fail-closed, nunca
 * fail-open).
 */
export async function startBillingSubscriptionAction(
  _prevState: StartBillingSubscriptionActionState,
  formData: FormData,
): Promise<StartBillingSubscriptionActionState> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { status: "error", message: "Sessão expirada. Faça login novamente." };
  }

  const membership = await resolveActiveTenantForUser(supabase);
  if (!membership) {
    return { status: "error", message: "Nenhuma loja encontrada para esta conta." };
  }

  const { data: allowed } = await supabase.rpc("has_permission", {
    p_tenant_id: membership.tenant.id,
    p_permission_key: "billing.manage",
  });
  if (!allowed) {
    return { status: "error", message: "Você não tem permissão para gerenciar a assinatura desta loja." };
  }

  const { data: profile } = await supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle();

  return startBillingSubscription(
    {
      supabase,
      gateway: getBillingGateway("asaas"),
      tenantId: membership.tenant.id,
      requesterName: profile?.full_name ?? membership.tenant.name,
      requesterEmail: profile?.email ?? user.email ?? "",
    },
    {
      planId: String(formData.get("planId") ?? ""),
      cycle: String(formData.get("cycle") ?? "") as "monthly" | "yearly",
      paymentMethod: String(formData.get("paymentMethod") ?? "") as "pix" | "card",
    },
  );
}
