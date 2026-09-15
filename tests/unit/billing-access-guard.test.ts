import { describe, expect, it } from "vitest";

import { checkBillingWriteAccess } from "@/features/billing/access-guard";

/**
 * JON-17 — camada de I/O fina sobre grace-status.ts (já testada
 * isoladamente em billing-grace-status.test.ts): só confirma que a leitura
 * de `subscriptions` é traduzida corretamente para {allowed}/{message},
 * mesmo padrão de mock de Supabase já usado em product-variant-actions.test.ts.
 */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

function mockClientWithSubscription(row: { status: string; past_due_since: string | null } | null) {
  return {
    from: (table: string) => {
      if (table !== "subscriptions") throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: row, error: null }),
          }),
        }),
      };
    },
  };
}

describe("checkBillingWriteAccess", () => {
  it("sem linha em subscriptions (tenant só em trial_records): nunca bloqueia", async () => {
    const client = mockClientWithSubscription(null);
    const result = await checkBillingWriteAccess(client as never, TENANT_ID);
    expect(result.allowed).toBe(true);
  });

  it("subscription 'active': nunca bloqueia", async () => {
    const client = mockClientWithSubscription({ status: "active", past_due_since: null });
    const result = await checkBillingWriteAccess(client as never, TENANT_ID);
    expect(result.allowed).toBe(true);
  });

  it("'past_due' há 2 dias (dentro da janela de aviso): não bloqueia escrita", async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const client = mockClientWithSubscription({ status: "past_due", past_due_since: twoDaysAgo });
    const result = await checkBillingWriteAccess(client as never, TENANT_ID);
    expect(result.allowed).toBe(true);
  });

  it("'past_due' há 5 dias (dia 4+): bloqueia, com mensagem amigável", async () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const client = mockClientWithSubscription({ status: "past_due", past_due_since: fiveDaysAgo });
    const result = await checkBillingWriteAccess(client as never, TENANT_ID);
    expect(result.allowed).toBe(false);
    expect(result.message).toMatch(/pagamento pendente/i);
  });
});
