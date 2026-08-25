import { NextResponse, type NextRequest } from "next/server";

import { getBillingEnv } from "@/lib/env";
import { processAsaasWebhookEvent } from "@/features/billing/webhook";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * Etapa 20.2.8 — endpoint de webhook do Asaas (BILLING: VEXO cobrando o
 * lojista, nunca o Mercado Pago do lojista — `app/api/webhooks/mercadopago/route.ts`
 * é o contexto completamente separado). Só `POST` é exportado —
 * `GET`/`PUT`/etc. recebem 405 automaticamente do App Router por não
 * terem handler.
 *
 * Nenhuma lógica de negócio mora aqui: toda a autenticação, parsing,
 * dedupe e tratamento de erro está em `features/billing/webhook.ts`
 * (função pura, testável por injeção — mesmo padrão de
 * `features/billing/start-subscription.ts`). Este arquivo só resolve as
 * dependências reais (env, cliente `service_role`) e traduz o resultado
 * para uma resposta HTTP.
 *
 * `service_role` é obrigatório aqui pelo mesmo motivo do webhook do
 * Mercado Pago: não existe sessão de usuário num webhook, e a
 * legitimidade da chamada vem inteiramente do header `asaas-access-token`
 * verificado dentro de `processAsaasWebhookEvent` — nunca de RLS. O
 * gateway é sempre `"asaas"`, nunca lido do payload/query — este endpoint
 * não aceita escolher gateway ou credencial.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const headerToken = request.headers.get("asaas-access-token");
  const { ASAAS_WEBHOOK_TOKEN } = getBillingEnv();
  const supabase = createSupabaseServiceRoleClient();

  const result = await processAsaasWebhookEvent({ supabase }, ASAAS_WEBHOOK_TOKEN, headerToken, rawBody);

  return new NextResponse(null, { status: result.httpStatus });
}
