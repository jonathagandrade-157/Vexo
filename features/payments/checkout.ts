import "server-only";

import { getPublicEnv } from "@/lib/env";
import { getGateway } from "@/lib/payments/registry";
import { getPaymentCredentials } from "@/lib/payments/vault";
import { createSupabasePublicClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

const PROVIDER = "mercadopago" as const;

/**
 * Mensagem de erro segura para log — nunca inclui headers/body da
 * requisição nem token/credencial (mesmo cuidado de
 * features/billing/webhook.ts:toSafeErrorMessage). O erro de uma chamada
 * supabase-js (rpc) é um objeto plano `PostgrestError`, não uma instância
 * de `Error`; o gateway Mercado Pago (lib/payments/mercadopago.ts) lança
 * `Error` com mensagem já sanitizada (nunca ecoa header/body, só URL/status).
 * Truncado por segurança contra uma mensagem anormalmente grande.
 */
function toSafeErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message.slice(0, 500);
  }
  if (err instanceof Error) return err.message.slice(0, 500);
  if (typeof err === "string") return err.slice(0, 500);
  return "unknown error";
}

/** Loja sem gateway conectado — checkout deve bloquear ANTES do formulário (prompt Etapa 11 §19), nunca mostrar um "pagar" que não funciona. */
export async function isPaymentGatewayConnected(tenantId: string): Promise<boolean> {
  const supabase = createSupabasePublicClient();
  const { data } = await supabase
    .from("store_payment_providers")
    .select("status")
    .eq("tenant_id", tenantId)
    .eq("provider", PROVIDER)
    .eq("status", "connected")
    .maybeSingle();
  return Boolean(data);
}

/**
 * Cria o registro de pagamento (RPC anon, valor sempre de orders.total)
 * → decifra o token do lojista (service_role, único uso extra desta
 * camada) → cria a preference no Mercado Pago → grava o preference_id.
 * Chamado depois de create_order_from_cart (Etapa 10, inalterada) — não
 * duplica a criação do pedido.
 */
export async function initiatePaymentForOrder(
  tenantId: string,
  orderId: string,
  customerEmail: string,
  storeSlug: string,
): Promise<{ checkoutUrl: string } | { error: string }> {
  const anon = createSupabasePublicClient();

  const { error: createError } = await anon.rpc("create_payment_for_order", {
    p_tenant_id: tenantId,
    p_order_id: orderId,
    p_provider: PROVIDER,
  });
  if (createError) {
    console.error("[payments] mercadopago create_payment_for_order failed", {
      tenantId,
      orderId,
      code: createError.code,
      message: toSafeErrorMessage(createError),
    });
    return { error: "Não foi possível iniciar o pagamento deste pedido." };
  }

  // Loja sem gateway conectado é estado de negócio esperado (o checkout já
  // bloqueia antes via isPaymentGatewayConnected) — não é falha operacional,
  // não registrado como log de erro para não gerar ruído não acionável.
  const credentials = await getPaymentCredentials(tenantId, PROVIDER);
  if (!credentials) {
    return { error: "Esta loja ainda não possui um meio de pagamento configurado." };
  }

  // orders.total/order_number lidos via service_role (anon não tem SELECT em orders, Etapa 10) — o mesmo valor que create_payment_for_order já usou para gravar payments.amount, nunca recalculado a partir de input externo.
  const { data: orderRow } = await createSupabaseServiceRoleClient()
    .from("orders")
    .select("total, order_number")
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!orderRow) {
    console.error("[payments] mercadopago order lookup failed after create_payment_for_order succeeded", {
      tenantId,
      orderId,
    });
    return { error: "Não foi possível iniciar o pagamento deste pedido." };
  }

  const { NEXT_PUBLIC_SITE_URL } = getPublicEnv();
  const gateway = getGateway(PROVIDER);

  let result;
  try {
    result = await gateway.createPayment({
      accessToken: credentials.accessToken,
      orderId,
      orderNumber: orderRow.order_number,
      amount: orderRow.total,
      customerEmail,
      backUrl: `${NEXT_PUBLIC_SITE_URL}/loja/${storeSlug}/pedido/${orderId}`,
      notificationUrl: `${NEXT_PUBLIC_SITE_URL}/api/webhooks/mercadopago`,
    });
  } catch (err) {
    console.error("[payments] mercadopago createPayment failed", {
      tenantId,
      orderId,
      message: toSafeErrorMessage(err),
    });
    return { error: "O Mercado Pago está indisponível no momento. Tente novamente em instantes." };
  }

  const { error: attachError } = await anon.rpc("attach_payment_preference", {
    p_tenant_id: tenantId,
    p_order_id: orderId,
    p_external_id: result.externalId,
  });
  if (attachError) {
    console.error("[payments] mercadopago attach_payment_preference failed", {
      tenantId,
      orderId,
      code: attachError.code,
      message: toSafeErrorMessage(attachError),
    });
    return { error: "Não foi possível iniciar o pagamento deste pedido." };
  }

  return { checkoutUrl: result.checkoutUrl };
}
