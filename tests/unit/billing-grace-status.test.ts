import { describe, expect, it } from "vitest";

import {
  billingGraceDaysElapsed,
  computeBillingGraceStatus,
  daysSince,
  isWriteBlockedByBilling,
  type SubscriptionGraceInput,
} from "@/features/billing/grace-status";

/**
 * JON-17 — critério de aceite "bloqueio de escrita" (dia 4+) e o aviso
 * (dias 0-3), cobertos isoladamente aqui (sem banco, sem componente —
 * mesmo princípio de save-status.test.ts, D20.9.1).
 */

const NOW = new Date("2026-09-20T12:00:00.000Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

describe("daysSince", () => {
  it("conta dias inteiros completos", () => {
    expect(daysSince(daysAgo(3), NOW)).toBe(3);
    expect(daysSince(daysAgo(0), NOW)).toBe(0);
    expect(daysSince(daysAgo(10), NOW)).toBe(10);
  });

  it("nunca negativo mesmo com uma data no futuro (defensivo)", () => {
    const future = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString();
    expect(daysSince(future, NOW)).toBe(0);
  });
});

describe("computeBillingGraceStatus", () => {
  it("status diferente de 'past_due' é sempre 'ok', mesmo com past_due_since preenchido (dado inconsistente, nunca confiado sozinho)", () => {
    const input: SubscriptionGraceInput = { status: "active", pastDueSince: daysAgo(30) };
    expect(computeBillingGraceStatus(input, NOW)).toBe("ok");
  });

  it("'past_due' sem past_due_since (nunca deveria acontecer, defensivo) é 'ok', nunca bloqueia sem uma âncora de tempo", () => {
    expect(computeBillingGraceStatus({ status: "past_due", pastDueSince: null }, NOW)).toBe("ok");
  });

  it("dia 0 (past_due_since = agora): 'warning'", () => {
    expect(computeBillingGraceStatus({ status: "past_due", pastDueSince: daysAgo(0) }, NOW)).toBe("warning");
  });

  it("dia 3: ainda 'warning' (limite superior da janela de aviso)", () => {
    expect(computeBillingGraceStatus({ status: "past_due", pastDueSince: daysAgo(3) }, NOW)).toBe("warning");
  });

  it("dia 4: já 'writes_blocked' (limite exato do bloqueio)", () => {
    expect(computeBillingGraceStatus({ status: "past_due", pastDueSince: daysAgo(4) }, NOW)).toBe("writes_blocked");
  });

  it("dia 9 (ainda antes do bloqueio de storefront, que é no banco, dia 10): 'writes_blocked'", () => {
    expect(computeBillingGraceStatus({ status: "past_due", pastDueSince: daysAgo(9) }, NOW)).toBe("writes_blocked");
  });

  it("dia 30: continua 'writes_blocked' (nunca volta a 'warning'/'ok' sozinho, só reativação real)", () => {
    expect(computeBillingGraceStatus({ status: "past_due", pastDueSince: daysAgo(30) }, NOW)).toBe("writes_blocked");
  });
});

describe("isWriteBlockedByBilling", () => {
  it("false nos dias 0-3, true a partir do dia 4", () => {
    expect(isWriteBlockedByBilling({ status: "past_due", pastDueSince: daysAgo(3) }, NOW)).toBe(false);
    expect(isWriteBlockedByBilling({ status: "past_due", pastDueSince: daysAgo(4) }, NOW)).toBe(true);
  });

  it("nunca bloqueia um tenant 'active'/'trialing'/'expired'/'cancelled'/'suspended'", () => {
    for (const status of ["active", "trialing", "expired", "cancelled", "suspended"]) {
      expect(isWriteBlockedByBilling({ status, pastDueSince: daysAgo(30) }, NOW)).toBe(false);
    }
  });
});

describe("billingGraceDaysElapsed", () => {
  it("0 quando não está em past_due", () => {
    expect(billingGraceDaysElapsed({ status: "active", pastDueSince: null }, NOW)).toBe(0);
  });

  it("reflete os dias corridos exatos, para exibir 'há N dias' no banner", () => {
    expect(billingGraceDaysElapsed({ status: "past_due", pastDueSince: daysAgo(2) }, NOW)).toBe(2);
    expect(billingGraceDaysElapsed({ status: "past_due", pastDueSince: daysAgo(15) }, NOW)).toBe(15);
  });
});
