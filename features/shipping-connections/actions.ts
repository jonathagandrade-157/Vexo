"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { getMelhorEnvioEnv, getPublicEnv } from "@/lib/env";
import { createOAuthState } from "@/lib/security/oauth-state";
import { getShippingConnectionGateway } from "@/lib/shipping-connections/registry";
import { deleteShippingCredentials } from "@/lib/shipping-connections/vault";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ShippingConnectionActionState } from "./schema";

const PROVIDER = "melhor_envio" as const;
const ENTREGA_PATH = "/painel/configuracoes/entrega";

/** Mesmo padrão de features/payments/actions.ts — checagem local, não compartilhada entre domínios. */
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
  return `${NEXT_PUBLIC_SITE_URL}/api/oauth/melhorenvio/callback`;
}

/**
 * Só monta a URL de autorização e redireciona — nenhuma credencial é
 * trocada aqui (isso acontece só no callback). `state` carrega o tenant
 * já autorizado (permissão checada acima), nunca aceito do cliente
 * depois.
 */
export async function connectMelhorEnvioAction(
  _prevState: ShippingConnectionActionState,
  _formData: FormData,
): Promise<ShippingConnectionActionState> {
  const resolved = await resolveTenantAndPermission("shipping_provider.manage");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const { OAUTH_STATE_SECRET } = getMelhorEnvioEnv();
  const state = createOAuthState(resolved.tenantId, OAUTH_STATE_SECRET);
  const gateway = getShippingConnectionGateway(PROVIDER);

  redirect(gateway.getAuthorizeUrl(state, callbackRedirectUri()));
}

export async function disconnectMelhorEnvioAction(): Promise<ShippingConnectionActionState> {
  const resolved = await resolveTenantAndPermission("shipping_provider.manage");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  try {
    await deleteShippingCredentials(resolved.tenantId, PROVIDER);
  } catch {
    return { status: "error", message: "Não foi possível desconectar. Tente novamente." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("store_shipping_providers")
    .update({ status: "disconnected", disconnected_at: new Date().toISOString() })
    .eq("tenant_id", resolved.tenantId)
    .eq("provider", PROVIDER);

  if (error) {
    return { status: "error", message: "Não foi possível desconectar. Tente novamente." };
  }

  revalidatePath(ENTREGA_PATH);
  return { status: "success", message: "Melhor Envio desconectado." };
}
