"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { getMercadoPagoEnv, getPublicEnv } from "@/lib/env";
import { getGateway } from "@/lib/payments/registry";
import { deletePaymentCredentials } from "@/lib/payments/vault";
import { createOAuthState } from "@/lib/security/oauth-state";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PaymentConnectionActionState } from "./schema";

const PROVIDER = "mercadopago" as const;

/** Mesmo padrão de features/products/actions.ts — checagem local, não compartilhada entre domínios. */
async function resolveTenantAndPermission(permissionKey: string): Promise<{ tenantId: string } | { error: string }> {
  const supabase = await createSupabaseServerClient();
  const membership = await resolveActiveTenantForUser(supabase);
  if (!membership || membership.tenant.onboarding_completed_at === null) {
    return { error: "Nenhuma loja configurada para esta conta." };
  }

  const { data: allowed } = await supabase.rpc("has_permission", {
    p_tenant_id: membership.tenant.id,
    p_permission_key: permissionKey,
  });
  if (!allowed) {
    return { error: "Você não tem permissão para esta ação." };
  }

  return { tenantId: membership.tenant.id };
}

function callbackRedirectUri(): string {
  const { NEXT_PUBLIC_SITE_URL } = getPublicEnv();
  return `${NEXT_PUBLIC_SITE_URL}/api/oauth/mercadopago/callback`;
}

/**
 * Só monta a URL de autorização e redireciona — nenhuma credencial é
 * trocada aqui (isso acontece só no callback, arquitetura §11). `state`
 * carrega o tenant já autorizado (permissão checada acima), nunca aceito
 * do cliente depois.
 */
export async function connectMercadoPagoAction(
  _prevState: PaymentConnectionActionState,
  _formData: FormData,
): Promise<PaymentConnectionActionState> {
  const resolved = await resolveTenantAndPermission("payments.manage");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const { OAUTH_STATE_SECRET } = getMercadoPagoEnv();
  const state = createOAuthState(resolved.tenantId, OAUTH_STATE_SECRET);
  const gateway = getGateway(PROVIDER);

  redirect(gateway.getAuthorizeUrl(state, callbackRedirectUri()));
}

export async function disconnectMercadoPagoAction(): Promise<PaymentConnectionActionState> {
  const resolved = await resolveTenantAndPermission("payments.manage");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  try {
    await deletePaymentCredentials(resolved.tenantId, PROVIDER);
  } catch {
    return { status: "error", message: "Não foi possível desconectar. Tente novamente." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("store_payment_providers")
    .update({ status: "disconnected", disconnected_at: new Date().toISOString() })
    .eq("tenant_id", resolved.tenantId)
    .eq("provider", PROVIDER);

  if (error) {
    return { status: "error", message: "Não foi possível desconectar. Tente novamente." };
  }

  revalidatePath("/painel/configuracoes/pagamentos");
  return { status: "success", message: "Mercado Pago desconectado." };
}
