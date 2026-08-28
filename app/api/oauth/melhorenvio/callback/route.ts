import { NextResponse, type NextRequest } from "next/server";

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { getMelhorEnvioEnv, getPublicEnv } from "@/lib/env";
import { verifyOAuthState } from "@/lib/security/oauth-state";
import { getShippingConnectionGateway } from "@/lib/shipping-connections/registry";
import { storeShippingCredentials } from "@/lib/shipping-connections/vault";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ENTREGA_PATH = "/painel/configuracoes/entrega";

function redirectWithError(request: NextRequest, code: string) {
  const { NEXT_PUBLIC_SITE_URL } = getPublicEnv();
  return NextResponse.redirect(new URL(`${ENTREGA_PATH}?me_error=${code}`, NEXT_PUBLIC_SITE_URL));
}

/**
 * Único ponto de entrada externo do fluxo OAuth do Melhor Envio (D3.2-B —
 * espelha 1:1 app/api/oauth/mercadopago/callback/route.ts, Etapa 11). Tem
 * que ser um Route Handler real (não Server Action), porque é o Melhor
 * Envio quem redireciona o navegador para cá com `code`+`state` via GET.
 *
 * Ordem de validação (idêntica ao Mercado Pago, prompt D3.2-B): `state`
 * (assinatura + expiração, nunca confia no tenant_id embutido sozinho) →
 * sessão atual ainda pertence a ESSE tenant com `shipping_provider.manage`
 * (segunda camada — o mesmo browser pode ter deslogado/trocado de conta
 * durante o round-trip externo) → troca o `code` por tokens inteiramente
 * no servidor → grava no vault (service_role, único uso aqui) → grava
 * metadado via client de sessão normal (RLS) → redireciona.
 *
 * Escopo estritamente D3.2-B: só conecta a conta. Nenhuma cotação, peso,
 * dimensão, Haversine, geocoding, GPS, mapa, motoboy, etiqueta, compra de
 * etiqueta, rastreamento, webhook de etiqueta ou uso do Melhor Envio no
 * checkout é tocado aqui.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (url.searchParams.get("error") || !code || !state) {
    return redirectWithError(request, "oauth_denied");
  }

  const { OAUTH_STATE_SECRET } = getMelhorEnvioEnv();
  const verified = verifyOAuthState(state, OAUTH_STATE_SECRET);
  if (!verified) {
    return redirectWithError(request, "invalid_state");
  }

  const supabase = await createSupabaseServerClient();
  const membership = await resolveActiveTenantForUser(supabase);
  if (!membership || membership.tenant.id !== verified.tenantId) {
    return redirectWithError(request, "session_mismatch");
  }

  const { data: allowed } = await supabase.rpc("has_permission", {
    p_tenant_id: verified.tenantId,
    p_permission_key: "shipping_provider.manage",
  });
  if (!allowed) {
    return redirectWithError(request, "session_mismatch");
  }

  const { MELHOR_ENVIO_SANDBOX } = getMelhorEnvioEnv();
  const gateway = getShippingConnectionGateway("melhor_envio");
  const { NEXT_PUBLIC_SITE_URL } = getPublicEnv();
  const redirectUri = `${NEXT_PUBLIC_SITE_URL}/api/oauth/melhorenvio/callback`;

  let tokens;
  try {
    tokens = await gateway.exchangeCodeForTokens(code, redirectUri);
  } catch {
    return redirectWithError(request, "exchange_failed");
  }

  try {
    await storeShippingCredentials(verified.tenantId, "melhor_envio", tokens);
  } catch {
    return redirectWithError(request, "vault_failed");
  }

  // connected_account_id/connected_account_email permanecem null aqui de
  // propósito: buscar essa informação exigiria chamar um endpoint do
  // Melhor Envio (ex.: "/me") cujo formato de resposta não foi confirmado
  // por acesso direto à documentação oficial neste ambiente — nunca
  // inventado (ver relatório final). A UI degrada mostrando só o status
  // "Conectado" + data, sem depender desses campos.
  const { error } = await supabase.from("store_shipping_providers").upsert(
    {
      tenant_id: verified.tenantId,
      provider: "melhor_envio",
      status: "connected",
      sandbox: MELHOR_ENVIO_SANDBOX,
      connected_at: new Date().toISOString(),
      disconnected_at: null,
    },
    { onConflict: "tenant_id,provider" },
  );
  if (error) {
    return redirectWithError(request, "connection_failed");
  }

  return NextResponse.redirect(new URL(`${ENTREGA_PATH}?me_connected=1`, NEXT_PUBLIC_SITE_URL));
}
