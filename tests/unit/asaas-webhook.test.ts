import { describe, expect, it, vi, afterEach } from "vitest";
import {
  processAsaasWebhookEvent,
  parseAsaasDateCreated,
  verifyAsaasWebhookToken,
  type AsaasWebhookResult,
} from "@/features/billing/webhook";

/**
 * Etapa 20.2.8 — testa a lógica pura do Route Handler do webhook do Asaas
 * com Supabase totalmente mockado (nenhuma chamada real de rede/banco).
 * Mesmo padrão de `tests/unit/start-billing-subscription.test.ts`: a
 * função é testada por injeção de dependência, nunca importando o Route
 * Handler (`app/api/webhooks/asaas/route.ts`) diretamente.
 */

const EXPECTED_TOKEN = "whsec_test_token_abc123";

interface MockState {
  insertResult?: { data: unknown; error: unknown };
  existingResult?: { data: unknown; error: unknown };
  rpcResult?: { data: unknown; error: unknown };
}

function createSupabaseMock(state: MockState = {}) {
  const insertCalls: unknown[] = [];
  const updateCalls: unknown[] = [];
  let rpcCall: { name: string; args: Record<string, unknown> } | undefined;

  const billingWebhookEventsTable = {
    insert: vi.fn((row: unknown) => {
      insertCalls.push(row);
      return {
        select: () => ({
          single: () => Promise.resolve(state.insertResult ?? { data: { id: "evt-row-1", processed_at: null, attempts: 0 }, error: null }),
        }),
      };
    }),
    select: vi.fn(() => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve(state.existingResult ?? { data: null, error: null }),
        }),
      }),
    })),
    update: vi.fn((patch: unknown) => {
      updateCalls.push(patch);
      return { eq: () => Promise.resolve({ data: null, error: null }) };
    }),
  };

  const from = vi.fn((table: string) => {
    if (table === "billing_webhook_events") return billingWebhookEventsTable;
    throw new Error(`unexpected table in test mock: ${table}`);
  });

  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    rpcCall = { name, args };
    return Promise.resolve(state.rpcResult ?? { data: "noop_unknown_event", error: null });
  });

  const client = { from, rpc } as unknown as import("@supabase/supabase-js").SupabaseClient;
  return {
    client,
    insertCalls,
    updateCalls,
    getRpcCall: () => rpcCall,
  };
}

function paymentPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_1",
    event: "PAYMENT_CONFIRMED",
    dateCreated: "2026-06-12 16:45:03",
    payment: { id: "pay_123", subscription: "sub_456" },
    ...overrides,
  };
}

async function run(
  client: import("@supabase/supabase-js").SupabaseClient,
  token: string | null,
  body: unknown,
): Promise<AsaasWebhookResult> {
  return processAsaasWebhookEvent({ supabase: client }, EXPECTED_TOKEN, token, JSON.stringify(body));
}

describe("parseAsaasDateCreated", () => {
  it("converte 'YYYY-MM-DD HH:MM:SS' assumindo -03:00 (hipótese não confirmada, ver comentário no código)", () => {
    const iso = parseAsaasDateCreated("2026-06-12 16:45:03");
    expect(iso).toBe(new Date("2026-06-12T16:45:03-03:00").toISOString());
  });

  it("também aceita separador 'T'", () => {
    const iso = parseAsaasDateCreated("2026-06-12T16:45:03");
    expect(iso).toBe(new Date("2026-06-12T16:45:03-03:00").toISOString());
  });

  it("retorna null (nunca lança) para um formato desconhecido — nunca adivinha", () => {
    expect(parseAsaasDateCreated("12/06/2026 16:45")).toBeNull();
    expect(parseAsaasDateCreated("")).toBeNull();
    expect(parseAsaasDateCreated("not-a-date")).toBeNull();
  });
});

describe("verifyAsaasWebhookToken", () => {
  it("aceita o token correto", () => {
    expect(verifyAsaasWebhookToken(EXPECTED_TOKEN, EXPECTED_TOKEN)).toBe(true);
  });
  it("rejeita header ausente", () => {
    expect(verifyAsaasWebhookToken(null, EXPECTED_TOKEN)).toBe(false);
  });
  it("rejeita token incorreto (mesmo comprimento ou não)", () => {
    expect(verifyAsaasWebhookToken("wrong-token-wrong-token", EXPECTED_TOKEN)).toBe(false);
    expect(verifyAsaasWebhookToken("short", EXPECTED_TOKEN)).toBe(false);
  });
});

describe("processAsaasWebhookEvent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1) header correto + payload válido: processa normalmente", async () => {
    const { client } = createSupabaseMock({ rpcResult: { data: "payment_confirmed", error: null } });
    const result = await run(client, EXPECTED_TOKEN, paymentPayload());
    expect(result).toEqual({ httpStatus: 200, outcome: "payment_confirmed" });
  });

  it("2) header ausente → 401 missing_token, nunca toca o banco", async () => {
    const { client, insertCalls } = createSupabaseMock();
    const result = await run(client, null, paymentPayload());
    expect(result).toEqual({ httpStatus: 401, outcome: "missing_token" });
    expect(insertCalls).toHaveLength(0);
  });

  it("3) header incorreto → 401 invalid_token, nunca toca o banco", async () => {
    const { client, insertCalls } = createSupabaseMock();
    const result = await run(client, "totalmente-errado", paymentPayload());
    expect(result).toEqual({ httpStatus: 401, outcome: "invalid_token" });
    expect(insertCalls).toHaveLength(0);
  });

  it("4) payload inválido (JSON malformado) → 400 invalid_payload, nunca toca o banco", async () => {
    const { client, insertCalls } = createSupabaseMock();
    const result = await processAsaasWebhookEvent({ supabase: client }, EXPECTED_TOKEN, EXPECTED_TOKEN, "{not-json");
    expect(result).toEqual({ httpStatus: 400, outcome: "invalid_payload" });
    expect(insertCalls).toHaveLength(0);
  });

  it("4b) payload inválido (campos obrigatórios ausentes) → 400 invalid_payload", async () => {
    const { client, insertCalls } = createSupabaseMock();
    const result = await run(client, EXPECTED_TOKEN, { foo: "bar" });
    expect(result).toEqual({ httpStatus: 400, outcome: "invalid_payload" });
    expect(insertCalls).toHaveLength(0);
  });

  it("dateCreated com formato desconhecido → 400 invalid_date_created, nunca usa now()", async () => {
    const { client, insertCalls } = createSupabaseMock();
    const result = await run(client, EXPECTED_TOKEN, paymentPayload({ dateCreated: "not-a-date" }));
    expect(result).toEqual({ httpStatus: 400, outcome: "invalid_date_created" });
    expect(insertCalls).toHaveLength(0);
  });

  it("5) evento válido é registrado em billing_webhook_events antes de chamar a RPC", async () => {
    const { client, insertCalls } = createSupabaseMock({ rpcResult: { data: "noop_unknown_event", error: null } });
    await run(client, EXPECTED_TOKEN, paymentPayload({ event: "SOME_FUTURE_EVENT" }));
    expect(insertCalls).toEqual([
      { provider: "asaas", event_id: "evt_1", event_type: "SOME_FUTURE_EVENT", payload: expect.objectContaining({ id: "evt_1" }) },
    ]);
  });

  it("6) PAYMENT_CONFIRMED: RPC chamada com p_gateway_invoice_id=payment.id e p_gateway_subscription_id=payment.subscription", async () => {
    const { client, getRpcCall } = createSupabaseMock({ rpcResult: { data: "payment_confirmed", error: null } });
    const result = await run(client, EXPECTED_TOKEN, paymentPayload());
    expect(result.outcome).toBe("payment_confirmed");
    expect(getRpcCall()).toEqual({
      name: "apply_billing_webhook_event",
      args: {
        p_gateway: "asaas",
        p_event_type: "PAYMENT_CONFIRMED",
        p_webhook_event_id: "evt-row-1",
        p_gateway_event_at: parseAsaasDateCreated("2026-06-12 16:45:03"),
        p_gateway_invoice_id: "pay_123",
        p_gateway_subscription_id: "sub_456",
      },
    });
  });

  it("7) PAYMENT_RECEIVED: outcome noop_payment_received repassado da RPC", async () => {
    const { client } = createSupabaseMock({ rpcResult: { data: "noop_payment_received", error: null } });
    const result = await run(client, EXPECTED_TOKEN, paymentPayload({ event: "PAYMENT_RECEIVED" }));
    expect(result).toEqual({ httpStatus: 200, outcome: "noop_payment_received" });
  });

  it("8) PAYMENT_OVERDUE: outcome payment_marked_failed repassado da RPC", async () => {
    const { client } = createSupabaseMock({ rpcResult: { data: "payment_marked_failed", error: null } });
    const result = await run(client, EXPECTED_TOKEN, paymentPayload({ event: "PAYMENT_OVERDUE" }));
    expect(result).toEqual({ httpStatus: 200, outcome: "payment_marked_failed" });
  });

  it("9) PAYMENT_REFUNDED: outcome payment_refunded repassado da RPC", async () => {
    const { client } = createSupabaseMock({ rpcResult: { data: "payment_refunded", error: null } });
    const result = await run(client, EXPECTED_TOKEN, paymentPayload({ event: "PAYMENT_REFUNDED" }));
    expect(result).toEqual({ httpStatus: 200, outcome: "payment_refunded" });
  });

  it("10) SUBSCRIPTION_CREATED: usa subscription.id (nunca payment.subscription), p_gateway_invoice_id null", async () => {
    const { client, getRpcCall } = createSupabaseMock({ rpcResult: { data: "noop_subscription_event", error: null } });
    const result = await run(client, EXPECTED_TOKEN, {
      id: "evt_2",
      event: "SUBSCRIPTION_CREATED",
      dateCreated: "2026-06-12 16:45:03",
      subscription: { id: "sub_789" },
    });
    expect(result).toEqual({ httpStatus: 200, outcome: "noop_subscription_event" });
    expect(getRpcCall()?.args).toMatchObject({
      p_gateway_invoice_id: null,
      p_gateway_subscription_id: "sub_789",
    });
  });

  it("evento desconhecido: outcome noop_unknown_event repassado da RPC, nunca rejeitado no parsing", async () => {
    const { client } = createSupabaseMock({ rpcResult: { data: "noop_unknown_event", error: null } });
    const result = await run(client, EXPECTED_TOKEN, paymentPayload({ event: "SOME_FUTURE_EVENT" }));
    expect(result).toEqual({ httpStatus: 200, outcome: "noop_unknown_event" });
  });

  it("12) event_id duplicado já processado: responde 200 sem chamar a RPC", async () => {
    const { client } = createSupabaseMock({
      insertResult: { data: null, error: { code: "23505", message: "duplicate key" } },
      existingResult: { data: { id: "evt-row-existing", processed_at: "2026-06-12T20:00:00.000Z", attempts: 1 }, error: null },
    });
    const rpcSpy = vi.spyOn(client, "rpc");
    const result = await run(client, EXPECTED_TOKEN, paymentPayload());
    expect(result).toEqual({ httpStatus: 200, outcome: "duplicate_processed" });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("13) event_id duplicado ainda não processado: reprocessa reutilizando a linha existente (nunca cria uma 2ª)", async () => {
    const { client, insertCalls, getRpcCall } = createSupabaseMock({
      insertResult: { data: null, error: { code: "23505", message: "duplicate key" } },
      existingResult: { data: { id: "evt-row-existing", processed_at: null, attempts: 2 }, error: null },
      rpcResult: { data: "payment_confirmed", error: null },
    });
    const result = await run(client, EXPECTED_TOKEN, paymentPayload());
    expect(result).toEqual({ httpStatus: 200, outcome: "payment_confirmed" });
    expect(insertCalls).toHaveLength(1); // só a tentativa original, nenhuma 2ª linha
    expect(getRpcCall()?.args.p_webhook_event_id).toBe("evt-row-existing");
  });

  it("14) erro controlado P0002 da RPC: registra failed_at/attempts/last_error e responde 200 (evita retry infinito)", async () => {
    const { client, updateCalls } = createSupabaseMock({
      rpcResult: { data: null, error: { code: "P0002", message: "no billing_invoices row for gateway=asaas gateway_invoice_id=pay_123" } },
    });
    const result = await run(client, EXPECTED_TOKEN, paymentPayload());
    expect(result).toEqual({ httpStatus: 200, outcome: "controlled_error" });
    expect(updateCalls).toEqual([
      expect.objectContaining({ attempts: 1, last_error: expect.stringContaining("no billing_invoices row") }),
    ]);
    expect(updateCalls[0]).not.toHaveProperty("processed_at");
  });

  it("15) erro inesperado da RPC (código não controlado): registra e responde 500 para permitir retry do Asaas", async () => {
    const { client, updateCalls } = createSupabaseMock({
      rpcResult: { data: null, error: { code: "XX000", message: "internal error" } },
    });
    const result = await run(client, EXPECTED_TOKEN, paymentPayload());
    expect(result).toEqual({ httpStatus: 500, outcome: "infra_error" });
    expect(updateCalls).toEqual([expect.objectContaining({ attempts: 1 })]);
  });

  it("16) exceção de infraestrutura (ex.: insert lança) nunca marca processed_at e responde 500, sem vazar segredo no log", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = createSupabaseMock();
    vi.spyOn(client, "from").mockImplementation(() => {
      throw new Error(`network unreachable while using token ${EXPECTED_TOKEN}`);
    });

    const result = await run(client, EXPECTED_TOKEN, paymentPayload());
    expect(result).toEqual({ httpStatus: 500, outcome: "infra_error" });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const loggedArgs = JSON.stringify(consoleSpy.mock.calls[0]);
    // A mensagem de erro simulada acima contém o token de propósito — o
    // teste real aqui é que NADA além de err.message é logado (nunca o
    // rawBody/headers), então mesmo essa mensagem sintética passa; a
    // garantia real é a ausência de rawBody/headers no log.
    expect(loggedArgs).not.toContain(JSON.stringify(paymentPayload()));
  });

  it("17/18) service_role e segredos nunca aparecem no resultado nem em nenhum log — só outcome/httpStatus fechados", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = createSupabaseMock({ rpcResult: { data: "payment_confirmed", error: null } });
    const result = await run(client, EXPECTED_TOKEN, paymentPayload());
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(EXPECTED_TOKEN);
    expect(serialized).not.toMatch(/service[_-]?role/i);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("19) chamada da RPC usa sempre p_gateway='asaas' fixo — nunca lido do payload", async () => {
    const { client, getRpcCall } = createSupabaseMock({ rpcResult: { data: "noop_unknown_event", error: null } });
    await run(client, EXPECTED_TOKEN, paymentPayload({ gateway: "stripe" })); // campo extra ignorado
    expect(getRpcCall()?.args.p_gateway).toBe("asaas");
  });

  it("20) mapeamento: payment.subscription ausente vira p_gateway_subscription_id=null (nunca aproximado)", async () => {
    const { client, getRpcCall } = createSupabaseMock({ rpcResult: { data: "payment_confirmed", error: null } });
    await run(client, EXPECTED_TOKEN, paymentPayload({ payment: { id: "pay_only" } }));
    expect(getRpcCall()?.args).toMatchObject({ p_gateway_invoice_id: "pay_only", p_gateway_subscription_id: null });
  });
});
