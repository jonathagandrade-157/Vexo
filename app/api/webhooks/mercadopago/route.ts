import { NextResponse, type NextRequest } from "next/server";

import { getGateway } from "@/lib/payments/registry";
import { getPaymentCredentials } from "@/lib/payments/vault";
import { getClientIp } from "@/lib/security/rate-limit";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * Mensagem de erro segura para log — mesmo padrão de
 * features/payments/checkout.ts:toSafeErrorMessage. Nunca inclui
 * headers/body da requisição nem token/credencial; truncado por
 * segurança contra mensagem anormalmente grande.
 */
function toSafeErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message.slice(0, 500);
  }
  if (err instanceof Error) return err.message.slice(0, 500);
  if (typeof err === "string") return err.slice(0, 500);
  return "unknown error";
}

/**
 * Endpoint de webhook do Mercado Pago (arquitetura §12.1). `service_role`
 * é usado aqui deliberadamente — não há sessão de usuário nenhuma num
 * webhook, e a legitimidade vem inteiramente da assinatura verificada
 * abaixo, não de RLS. O tenant nunca é aceito de um campo solto do
 * payload: é sempre resolvido por `connected_account_id`, cruzado contra
 * `store_payment_providers` (o registro que a própria VEXO gravou no
 * momento da conexão OAuth).
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const gateway = getGateway("mercadopago");

  // Assinatura verificada ANTES de qualquer parsing de negócio (§12.1) —
  // falha aqui nunca toca o banco.
  if (!gateway.verifyWebhookSignature(request.headers, rawBody)) {
    // getClientIp já existe (lib/security/rate-limit.ts, D15-S.2, em
    // produção) — reaproveitado aqui, nenhuma infraestrutura nova. Nunca
    // loga a assinatura recebida nem o rawBody (poderia ecoar payload
    // forjado); só metadados que já eram públicos na requisição.
    console.error("[webhooks] mercadopago invalid signature", {
      ip: getClientIp(request),
      requestId: request.headers.get("x-request-id"),
      bodyLength: rawBody.length,
    });
    return new NextResponse(null, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const event = gateway.parseWebhookEvent(request.headers, payload);
  if (!event) {
    return new NextResponse(null, { status: 400 });
  }

  const supabase = createSupabaseServiceRoleClient();

  // Idempotência real: (provider, event_id) único. Um evento já
  // PROCESSADO (processed_at preenchido) retorna 200 sem reaplicar
  // efeito colateral — nunca creditar/atualizar um pedido duas vezes.
  // Um evento que existe mas NÃO foi processado (tentativa anterior
  // falhou no meio do caminho) é reprocessado normalmente — o passo
  // final (apply_payment_update) é ele mesmo um upsert seguro de
  // reaplicar.
  const { error: insertError } = await supabase
    .from("payment_webhook_events")
    .insert({ provider: "mercadopago", event_id: event.eventId, payload: payload as object });

  if (insertError) {
    if (insertError.code !== "23505") {
      return new NextResponse(null, { status: 500 });
    }
    const { data: existing } = await supabase
      .from("payment_webhook_events")
      .select("processed_at")
      .eq("provider", "mercadopago")
      .eq("event_id", event.eventId)
      .maybeSingle();
    if (existing?.processed_at) {
      return new NextResponse(null, { status: 200 });
    }
  }

  if (event.paymentExternalId && event.providerAccountId) {
    const { data: providerRow } = await supabase
      .from("store_payment_providers")
      .select("tenant_id")
      .eq("provider", "mercadopago")
      .eq("connected_account_id", event.providerAccountId)
      .eq("status", "connected")
      .maybeSingle();

    if (providerRow) {
      const credentials = await getPaymentCredentials(providerRow.tenant_id, "mercadopago");
      if (credentials) {
        try {
          const payment = await gateway.getPayment(credentials.accessToken, event.paymentExternalId);
          if (payment.externalReference) {
            await supabase.rpc("apply_payment_update", {
              p_tenant_id: providerRow.tenant_id,
              p_order_id: payment.externalReference,
              p_provider: "mercadopago",
              p_external_id: payment.externalId,
              p_status: payment.status,
              p_method: payment.method,
              p_amount: payment.amount,
            });
          }
        } catch (err) {
          // Consulta ao Mercado Pago falhou (indisponibilidade, token
          // expirado, etc.) — não marca processed_at, deixa o próprio
          // webhook (MP reenvia) ou uma consulta futura reprocessar. O
          // status 200 é mantido de propósito (semântica de retry do MP
          // inalterada) — o log abaixo só existe para dar visibilidade a
          // uma falha hoje completamente silenciosa.
          console.error("[webhooks] mercadopago post-signature processing failed", {
            tenantId: providerRow.tenant_id,
            eventId: event.eventId,
            paymentExternalId: event.paymentExternalId,
            message: toSafeErrorMessage(err),
          });
          return new NextResponse(null, { status: 200 });
        }
      }
    }
  }

  await supabase
    .from("payment_webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("provider", "mercadopago")
    .eq("event_id", event.eventId);

  return new NextResponse(null, { status: 200 });
}
