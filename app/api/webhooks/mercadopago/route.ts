import { NextResponse, type NextRequest } from "next/server";

import { getGateway } from "@/lib/payments/registry";
import { getPaymentCredentials } from "@/lib/payments/vault";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

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
        } catch {
          // Consulta ao Mercado Pago falhou (indisponibilidade, token
          // expirado, etc.) — não marca processed_at, deixa o próprio
          // webhook (MP reenvia) ou uma consulta futura reprocessar.
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
