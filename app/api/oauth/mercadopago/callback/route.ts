import { NextResponse, type NextRequest } from "next/server";

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { getMercadoPagoEnv, getPublicEnv } from "@/lib/env";
import { getGateway } from "@/lib/payments/registry";
import { storePaymentCredentials } from "@/lib/payments/vault";
import { verifyOAuthState } from "@/lib/security/oauth-state";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const PAGAMENTOS_PATH = "/painel/configuracoes/pagamentos";

function redirectWithError(request: NextRequest, code: string) {
  const { NEXT_PUBLIC_SITE_URL } = getPublicEnv();
  return NextResponse.redirect(new URL(`${PAGAMENTOS_PATH}?error=${code}`, NEXT_PUBLIC_SITE_URL));
}

/**
 * Único ponto de entrada externo do fluxo OAuth (arquitetura §11) — tem
 * que ser um Route Handler real (não Server Action), porque é o Mercado
 * Pago quem redireciona o navegador para cá com `code`+`state` via GET.
 *
 * Ordem de validação: `state` (assinatura + expiração, nunca confia no
 * tenant_id embutido sozinho) → sessão atual ainda pertence a ESSE
 * tenant com `payments.manage` (segunda camada — o mesmo browser pode
 * ter deslogado/trocado de conta durante o round-trip externo) → troca
 * o `code` por tokens inteiramente no servidor → grava no vault
 * (service_role, único uso aqui) → metadado via client de sessão normal
 * (RLS).
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (url.searchParams.get("error") || !code || !state) {
    return redirectWithError(request, "oauth_denied");
  }

  const { OAUTH_STATE_SECRET } = getMercadoPagoEnv();
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
    p_permission_key: "payments.manage",
  });
  if (!allowed) {
    return redirectWithError(request, "session_mismatch");
  }

  const gateway = getGateway("mercadopago");
  const { NEXT_PUBLIC_SITE_URL } = getPublicEnv();
  const redirectUri = `${NEXT_PUBLIC_SITE_URL}/api/oauth/mercadopago/callback`;

  let tokens;
  try {
    tokens = await gateway.exchangeCodeForTokens(code, redirectUri);
  } catch {
    return redirectWithError(request, "exchange_failed");
  }

  try {
    await storePaymentCredentials(verified.tenantId, "mercadopago", tokens);
  } catch {
    return redirectWithError(request, "vault_failed");
  }

  const { error } = await supabase.from("store_payment_providers").upsert(
    {
      tenant_id: verified.tenantId,
      provider: "mercadopago",
      status: "connected",
      connected_account_id: tokens.providerAccountId,
      connected_at: new Date().toISOString(),
      disconnected_at: null,
    },
    { onConflict: "tenant_id,provider" },
  );
  if (error) {
    return redirectWithError(request, "connection_failed");
  }

  return NextResponse.redirect(new URL(`${PAGAMENTOS_PATH}?connected=1`, NEXT_PUBLIC_SITE_URL));
}
