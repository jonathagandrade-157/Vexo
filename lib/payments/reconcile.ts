import "server-only";

import * as Sentry from "@sentry/nextjs";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { getGateway } from "./registry";
import { getPaymentCredentials } from "./vault";

const PROVIDER = "mercadopago" as const;

/** Aprovado no ticket: cron a cada 15min, reconcilia pedidos pendentes há mais de 30min. */
export const STALE_AFTER_MINUTES = 30;
/** Teto por execução — nunca processar sem limite, mesmo se muitos pedidos acumularem. */
export const MAX_ORDERS_PER_RUN = 50;

export interface ReconcilePaymentsResult {
  checked: number;
  reconciled: number;
}

/**
 * JON-15 — chamada só pelo Route Handler do cron
 * (app/api/cron/reconcile-payments/route.ts). Nunca é o caminho de
 * escrita principal: todo pedido continua sendo resolvido pelo webhook
 * normalmente na grande maioria dos casos — isto é a rede de segurança
 * pros casos em que o webhook nunca chegou (indisponibilidade momentânea,
 * erro de rede, etc., arquitetura §12.1).
 *
 * Cada pedido é processado isoladamente (try/catch por item): uma falha
 * em UM pedido (Mercado Pago indisponível, credencial revogada, etc.)
 * nunca impede os demais de serem reconciliados na mesma execução.
 * `apply_payment_update` — a MESMA função que o webhook já usa (migration
 * 20260817220043, com a guarda "aprovado é grudento" da migration
 * 20260817220121) — é sempre reaproveitada pra escrever o resultado, nunca
 * um caminho de escrita paralelo; ela trata qualquer status definitivo
 * (APPROVED/REJECTED/CANCELLED/REFUNDED) corretamente, não só aprovado, e
 * nunca deixa um p_status fora de ordem reverter um pagamento já aprovado
 * — o que importa aqui porque `searchPaymentByExternalReference` pode
 * devolver, entre várias tentativas de pagamento do mesmo pedido, uma que
 * não seja a definitiva (ela já prioriza um resultado APPROVED quando
 * existe, mas a guarda no banco é a última linha de defesa).
 */
export async function reconcileStalePendingPayments(): Promise<ReconcilePaymentsResult> {
  const supabase = createSupabaseServiceRoleClient();
  const olderThan = new Date(Date.now() - STALE_AFTER_MINUTES * 60 * 1000).toISOString();

  const { data: staleOrders, error: listError } = await supabase.rpc("list_stale_pending_gateway_payments", {
    p_older_than: olderThan,
    p_limit: MAX_ORDERS_PER_RUN,
  });
  if (listError || !staleOrders) {
    Sentry.captureException(new Error(`JON-15: list_stale_pending_gateway_payments failed: ${listError?.message ?? "no data returned"}`));
    return { checked: 0, reconciled: 0 };
  }

  const gateway = getGateway(PROVIDER);
  let reconciled = 0;

  for (const { tenant_id: tenantId, order_id: orderId } of staleOrders) {
    try {
      const credentials = await getPaymentCredentials(tenantId, PROVIDER);
      // Loja desconectou o gateway nesse meio-tempo — nada a consultar, nada a reconciliar.
      if (!credentials) continue;

      const payment = await gateway.searchPaymentByExternalReference(credentials.accessToken, orderId);
      // Sem resultado, ou ainda PENDING no próprio Mercado Pago (cliente
      // ainda não terminou de pagar) — não é um webhook perdido, é um
      // pedido genuinamente em andamento. Próxima execução tenta de novo.
      if (!payment || payment.status === "PENDING") continue;

      const { error: applyError } = await supabase.rpc("apply_payment_update", {
        p_tenant_id: tenantId,
        p_order_id: orderId,
        p_provider: PROVIDER,
        p_external_id: payment.externalId,
        p_status: payment.status,
        p_method: payment.method,
        p_amount: payment.amount,
      });
      if (applyError) throw new Error(`apply_payment_update failed: ${applyError.message}`);

      reconciled += 1;
    } catch (err) {
      // Isolado por pedido — nunca derruba o processamento dos demais.
      Sentry.captureException(err, { extra: { tenantId, orderId } });
    }
  }

  // Sinal de saúde do webhook (nunca disparado numa execução que não
  // encontrou nada — isso é o caso normal/esperado, não um alerta).
  if (reconciled > 0) {
    Sentry.captureMessage(`JON-15: reconciliação encontrou ${reconciled} pagamento(s) que o webhook do Mercado Pago perdeu.`, {
      level: "warning",
      extra: { checked: staleOrders.length, reconciled },
    });
  }

  return { checked: staleOrders.length, reconciled };
}
