/**
 * JON-17 — modelo de carência (grace period) de inadimplência, pura e sem
 * I/O (o componente/Server Action só orquestra em cima disto, mesmo
 * princípio de gallery-logic.ts/variant-combinations.ts/save-status.ts).
 *
 * Dias 0-3 desde `subscriptions.past_due_since`: acesso total mantido, só
 * aviso. Dia 4+: bloqueia escrita no painel (nunca leitura, nunca a loja
 * pública — isso é `is_storefront_blocked()`, no banco, dia 10+,
 * deliberadamente um limite diferente e mais tardio). `subscriptions.
 * status !== 'past_due'` ou `past_due_since` nulo (nunca esteve em
 * atraso, ou já foi reativado) sempre resultam em "ok".
 */
export type BillingGraceStatus = "ok" | "warning" | "writes_blocked";

export interface SubscriptionGraceInput {
  /** `subscriptions.status` cru — só `'past_due'` é relevante aqui; qualquer outro valor (incluindo null/ausente) é "ok". */
  status: string | null;
  /** `subscriptions.past_due_since` cru — ISO string (vindo do Supabase) ou Date. */
  pastDueSince: string | Date | null;
}

/** Dias 0-3 desde past_due_since: aviso, sem bloqueio de escrita. */
export const GRACE_WARNING_MAX_DAYS = 3;
/** Dia 4+: bloqueia escrita no painel (produtos/configurações/etc — nunca a loja pública). */
export const GRACE_WRITE_BLOCK_DAYS = 4;

/** Dias inteiros completos desde `since` até `now` — nunca negativo (defensivo: um `since` no futuro, por relógio de servidor divergente, nunca gera "-1 dias"). */
export function daysSince(since: string | Date, now: Date = new Date()): number {
  const sinceDate = since instanceof Date ? since : new Date(since);
  const diffMs = now.getTime() - sinceDate.getTime();
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

export function computeBillingGraceStatus(input: SubscriptionGraceInput, now: Date = new Date()): BillingGraceStatus {
  if (input.status !== "past_due" || !input.pastDueSince) return "ok";
  const days = daysSince(input.pastDueSince, now);
  return days >= GRACE_WRITE_BLOCK_DAYS ? "writes_blocked" : "warning";
}

/** Atalho usado pelas Server Actions de escrita — só isso importa para elas, nunca o status intermediário. */
export function isWriteBlockedByBilling(input: SubscriptionGraceInput, now: Date = new Date()): boolean {
  return computeBillingGraceStatus(input, now) === "writes_blocked";
}

/** Dias completos de carência já decorridos — só usado para exibir "há N dias" no banner do painel; `0` quando `status === "ok"`. */
export function billingGraceDaysElapsed(input: SubscriptionGraceInput, now: Date = new Date()): number {
  if (input.status !== "past_due" || !input.pastDueSince) return 0;
  return daysSince(input.pastDueSince, now);
}
