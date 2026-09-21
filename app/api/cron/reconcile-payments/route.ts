import { NextResponse, type NextRequest } from "next/server";

import { getCronEnv } from "@/lib/env";
import { reconcileStalePendingPayments } from "@/lib/payments/reconcile";

// Plano Pro na Vercel — até 50 chamadas sequenciais ao Mercado Pago
// (MAX_ORDERS_PER_RUN, lib/payments/reconcile.ts) numa única execução do
// cron, sem risco de estourar o limite default de duração da função.
export const maxDuration = 60;

/**
 * JON-15 — endpoint chamado pelo Vercel Cron (vercel.json, a cada 15 minutos).
 * Padrão oficial da Vercel para proteger um endpoint de cron: comparar o
 * header `Authorization: Bearer <CRON_SECRET>` que a própria Vercel envia
 * em toda invocação — nunca IP allowlist (sem IP de origem fixo
 * documentado). Um `Authorization` ausente/errado nunca chega a chamar
 * `reconcileStalePendingPayments` (nem lista nem consulta nenhum pedido).
 */
export async function GET(request: NextRequest) {
  const { CRON_SECRET } = getCronEnv();
  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${CRON_SECRET}`) {
    return new NextResponse(null, { status: 401 });
  }

  const result = await reconcileStalePendingPayments();
  return NextResponse.json(result);
}
