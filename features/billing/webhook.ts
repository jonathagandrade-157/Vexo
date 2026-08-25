import "server-only";

import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Etapa 20.2.8 — Route Handler do webhook do Asaas
 * (`app/api/webhooks/asaas/route.ts`). Lógica pura, testável por injeção
 * de dependência (mesmo padrão de `features/billing/start-subscription.ts`
 * — nenhum teste unitário deste projeto importa um Route Handler
 * diretamente).
 *
 * Esta função NUNCA cria/altera a RPC `apply_billing_webhook_event`
 * (migration 20260817220074, já aplicada em produção) — só monta os
 * parâmetros exatos que ela espera e interpreta o retorno textual fechado
 * dela. Toda a lógica de idempotência/ordem/estado já vive na RPC; este
 * arquivo só cuida de autenticação, parsing do payload, registro em
 * `billing_webhook_events` e tratamento de erro da chamada.
 */

// ---------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------

/**
 * Formato confirmado via pesquisa (docs.asaas.com/docs/receive-asaas-events-at-your-webhook-endpoint,
 * docs.asaas.com/docs/payment-events — WebFetch direto para docs.asaas.com
 * está bloqueado pelo proxy deste ambiente, confirmado via WebSearch):
 * `{ id, event, dateCreated, payment?: { id, subscription? }, subscription?: { id } }`.
 * `payment` aparece em eventos PAYMENT_*, `subscription` (top-level) em
 * eventos SUBSCRIPTION_*. Nunca inventamos campos além destes — qualquer
 * outro campo do payload real é ignorado, não validado.
 */
export const asaasWebhookPayloadSchema = z.object({
  id: z.string().min(1),
  event: z.string().min(1),
  dateCreated: z.string().min(1),
  payment: z
    .object({
      id: z.string().min(1),
      subscription: z.string().min(1).nullable().optional(),
    })
    .optional(),
  subscription: z
    .object({
      id: z.string().min(1),
    })
    .optional(),
});

export type AsaasWebhookPayload = z.infer<typeof asaasWebhookPayloadSchema>;

// ---------------------------------------------------------------------
// dateCreated → timestamptz
// ---------------------------------------------------------------------

const DATE_CREATED_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

/**
 * HIPÓTESE NÃO CONFIRMADA OFICIALMENTE (Etapa 20.2.8, decisão explícita do
 * usuário registrada no relatório desta etapa): toda fonte que conseguimos
 * consultar (WebSearch — WebFetch direto para docs.asaas.com está
 * bloqueado pelo proxy deste ambiente) mostra `dateCreated` do webhook
 * SEMPRE sem timezone explícito (`"2024-06-12 16:45:03"` — sem 'T', sem
 * offset, sem 'Z'). Assumimos horário de Brasília fixo (`-03:00`, sem
 * horário de verão — o Brasil não usa DST desde 2019) até validar contra
 * um evento REAL do Sandbox, autorizado explicitamente para uma etapa
 * futura antes de qualquer webhook real ser cadastrado em produção. NUNCA
 * usar `now()`/hora de recebimento como substituto — isso violaria a
 * garantia de ordem por `last_gateway_event_at` que a RPC já impõe.
 *
 * Retorna `null` (nunca lança) quando o formato não bate com o padrão
 * conhecido — trata como payload inválido, nunca tenta adivinhar.
 */
export function parseAsaasDateCreated(raw: string): string | null {
  const match = DATE_CREATED_PATTERN.exec(raw.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}-03:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

// ---------------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------------

/**
 * Header estático `asaas-access-token` (nunca HMAC — mecanismo diferente
 * do Mercado Pago, confirmado em docs.asaas.com/docs/webhooks-3).
 * Comparação em tempo constante, mesmo padrão de
 * `lib/payments/mercadopago.ts` (`verifyWebhookSignature`).
 */
export function verifyAsaasWebhookToken(headerValue: string | null, expectedToken: string): boolean {
  if (!headerValue) return false;
  const expectedBuf = Buffer.from(expectedToken);
  const receivedBuf = Buffer.from(headerValue);
  return expectedBuf.length === receivedBuf.length && timingSafeEqual(expectedBuf, receivedBuf);
}

// ---------------------------------------------------------------------
// Orquestração
// ---------------------------------------------------------------------

export interface AsaasWebhookDeps {
  supabase: SupabaseClient;
}

/**
 * Vocabulário fechado de resultado. Os 8 primeiros valores são exatamente
 * o retorno textual da RPC `apply_billing_webhook_event` (repassado sem
 * tradução); os demais são exclusivos desta camada (autenticação,
 * parsing, dedupe, erro).
 */
export type AsaasWebhookOutcome =
  | "payment_confirmed"
  | "payment_marked_failed"
  | "payment_refunded"
  | "skipped_stale_event"
  | "noop_payment_received"
  | "noop_already_pending"
  | "noop_subscription_event"
  | "noop_unknown_event"
  | "missing_token"
  | "invalid_token"
  | "invalid_payload"
  | "invalid_date_created"
  | "duplicate_processed"
  | "controlled_error"
  | "infra_error";

export interface AsaasWebhookResult {
  httpStatus: number;
  outcome: AsaasWebhookOutcome;
}

function toSafeErrorMessage(err: unknown): string {
  // O erro de uma chamada supabase-js (insert/rpc) é um objeto plano
  // `PostgrestError` (`{message, details, hint, code}`), não uma instância
  // de `Error` — precisa ser checado separadamente, senão cai sempre no
  // fallback genérico. Nunca loga o payload/headers da requisição — só a
  // mensagem de erro do Postgres/driver, que nunca carrega o token do
  // webhook nem a API key do Asaas (esta função nunca fala com a API do
  // Asaas). Truncado por segurança contra uma mensagem anormalmente grande.
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message.slice(0, 500);
  }
  if (err instanceof Error) return err.message.slice(0, 500);
  if (typeof err === "string") return err.slice(0, 500);
  return "unknown error";
}

/** Postgres SQLSTATEs que a RPC usa deliberadamente para erro controlado (ver migration 20260817220074). */
const CONTROLLED_RPC_ERROR_CODES = new Set(["P0002", "P0001"]);

interface WebhookEventRow {
  id: string;
  processed_at: string | null;
  attempts: number;
}

export async function processAsaasWebhookEvent(
  deps: AsaasWebhookDeps,
  expectedToken: string,
  headerToken: string | null,
  rawBody: string,
): Promise<AsaasWebhookResult> {
  // 1) Autenticação SEMPRE primeiro — nada do corpo é tocado antes disso.
  if (!headerToken) return { httpStatus: 401, outcome: "missing_token" };
  if (!verifyAsaasWebhookToken(headerToken, expectedToken)) {
    return { httpStatus: 401, outcome: "invalid_token" };
  }

  // 2) Parse + validação do payload — nunca chega na RPC/banco se inválido.
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { httpStatus: 400, outcome: "invalid_payload" };
  }
  const parsed = asaasWebhookPayloadSchema.safeParse(json);
  if (!parsed.success) {
    return { httpStatus: 400, outcome: "invalid_payload" };
  }
  const payload = parsed.data;

  const gatewayEventAt = parseAsaasDateCreated(payload.dateCreated);
  if (!gatewayEventAt) {
    return { httpStatus: 400, outcome: "invalid_date_created" };
  }

  // payment.subscription para PAYMENT_*, subscription.id para
  // SUBSCRIPTION_* — nunca tenant_id do payload, nunca misturado entre os
  // dois campos.
  const gatewayInvoiceId = payload.payment?.id ?? null;
  const gatewaySubscriptionId = payload.event.startsWith("SUBSCRIPTION_")
    ? (payload.subscription?.id ?? null)
    : (payload.payment?.subscription ?? null);

  const { supabase } = deps;

  try {
    // 3) Registra o evento ANTES de chamar a RPC — UNIQUE(provider,
    // event_id) é a chave real de idempotência (mesmo padrão exato de
    // payment_webhook_events / app/api/webhooks/mercadopago/route.ts).
    const { data: inserted, error: insertError } = await supabase
      .from("billing_webhook_events")
      .insert({ provider: "asaas", event_id: payload.id, event_type: payload.event, payload: json as object })
      .select("id, processed_at, attempts")
      .single();

    let eventRow: WebhookEventRow;
    if (insertError) {
      if (insertError.code !== "23505") {
        return { httpStatus: 500, outcome: "infra_error" };
      }
      // event_id já existe — nunca cria uma 2ª linha. Reaproveita a
      // existente: já processada responde 200 sem chamar a RPC de novo;
      // ainda não processada é reprocessada normalmente.
      const { data: existing, error: fetchError } = await supabase
        .from("billing_webhook_events")
        .select("id, processed_at, attempts")
        .eq("provider", "asaas")
        .eq("event_id", payload.id)
        .maybeSingle<WebhookEventRow>();
      if (fetchError || !existing) {
        return { httpStatus: 500, outcome: "infra_error" };
      }
      if (existing.processed_at) {
        return { httpStatus: 200, outcome: "duplicate_processed" };
      }
      eventRow = existing;
    } else {
      eventRow = inserted as WebhookEventRow;
    }

    // 4) Encaminha para a RPC já existente em produção.
    const { data: rpcResult, error: rpcError } = await supabase.rpc("apply_billing_webhook_event", {
      p_gateway: "asaas",
      p_event_type: payload.event,
      p_webhook_event_id: eventRow.id,
      p_gateway_event_at: gatewayEventAt,
      p_gateway_invoice_id: gatewayInvoiceId,
      p_gateway_subscription_id: gatewaySubscriptionId,
    });

    if (rpcError) {
      // DB está alcançável (a chamada retornou um erro estruturado, não
      // uma exceção de rede) — sempre seguro registrar attempts/erro aqui,
      // mesmo quando o erro é inesperado (regra 9).
      await supabase
        .from("billing_webhook_events")
        .update({ failed_at: new Date().toISOString(), attempts: eventRow.attempts + 1, last_error: toSafeErrorMessage(rpcError) })
        .eq("id", eventRow.id);

      if (CONTROLLED_RPC_ERROR_CODES.has(rpcError.code ?? "")) {
        // Erro controlado (P0002/P0001) — evento genuinamente
        // inconsistente (sem invoice correspondente, mismatch de
        // subscription). Responde 200 para não gerar retries infinitos de
        // um evento que nunca vai se tornar consistente sozinho (regra 8).
        return { httpStatus: 200, outcome: "controlled_error" };
      }
      // Erro inesperado — responde 5xx para o Asaas tentar de novo mais
      // tarde (regra 9).
      return { httpStatus: 500, outcome: "infra_error" };
    }

    await supabase
      .from("billing_webhook_events")
      .update({ processed_at: new Date().toISOString(), attempts: eventRow.attempts + 1 })
      .eq("id", eventRow.id);

    return { httpStatus: 200, outcome: rpcResult as AsaasWebhookOutcome };
  } catch (err) {
    // Exceção de infraestrutura de verdade (rede caiu, etc.) — nunca
    // presume que billing_webhook_events está alcançável para registrar
    // attempts/erro com segurança (regra 9). Nenhum segredo no log: só a
    // mensagem do erro, nunca o payload/headers da requisição.
    console.error("BILLING_WEBHOOK_INFRA_ERROR", { message: toSafeErrorMessage(err) });
    return { httpStatus: 500, outcome: "infra_error" };
  }
}
