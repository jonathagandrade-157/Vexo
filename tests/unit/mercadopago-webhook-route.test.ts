import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/payments/registry", () => ({ getGateway: vi.fn() }));
vi.mock("@/lib/payments/vault", () => ({ getPaymentCredentials: vi.fn() }));
vi.mock("@/lib/security/rate-limit", () => ({ getClientIp: vi.fn(() => "127.0.0.1") }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceRoleClient: vi.fn() }));

import { POST } from "@/app/api/webhooks/mercadopago/route";
import { getGateway } from "@/lib/payments/registry";
import { getPaymentCredentials } from "@/lib/payments/vault";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const ORDER_ID = "33333333-3333-3333-3333-333333333333";

interface SupabaseOptions {
  insertError?: unknown;
  existing?: { processed_at: string | null } | null;
  providerRow?: { tenant_id: string; connected_account_id: string } | null;
  localPayment?: { amount: number } | null;
  localPaymentError?: unknown;
  applyError?: unknown;
  processedError?: unknown;
}

function thenableResult(result: unknown) {
  const chain = {
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function fakeSupabase(options: SupabaseOptions = {}) {
  const insert = vi.fn().mockResolvedValue({ error: options.insertError ?? null });
  const eventsSelect = vi.fn(() => thenableResult({ data: options.existing ?? null, error: null }));
  const eventsUpdate = vi.fn(() => thenableResult({ error: options.processedError ?? null }));
  const providerSelect = vi.fn(() =>
    thenableResult({
      data: options.providerRow === undefined
        ? { tenant_id: TENANT_ID, connected_account_id: "seller-123" }
        : options.providerRow,
      error: null,
    }),
  );
  const paymentSelect = vi.fn(() =>
    thenableResult({
      data: options.localPayment === undefined ? { amount: 100 } : options.localPayment,
      error: options.localPaymentError ?? null,
    }),
  );
  const from = vi.fn((table: string) => {
    if (table === "payment_webhook_events") return { insert, select: eventsSelect, update: eventsUpdate };
    if (table === "store_payment_providers") return { select: providerSelect };
    if (table === "payments") return { select: paymentSelect };
    throw new Error(`unexpected table: ${table}`);
  });
  const rpc = vi.fn().mockResolvedValue({ error: options.applyError ?? null });
  return { from, rpc, insert, eventsUpdate, providerSelect, paymentSelect };
}

function webhookRequest(options: { queryId?: string; bodyId?: string; userId?: string } = {}): NextRequest {
  const queryId = options.queryId ?? "pay-123";
  const bodyId = options.bodyId ?? "pay-123";
  const userId = options.userId ?? "seller-123";
  const url = new URL("http://localhost:3000/api/webhooks/mercadopago");
  if (queryId) url.searchParams.set("data.id", queryId);
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "req-123", "x-signature": "signed" },
    body: JSON.stringify({ id: "event-123", user_id: userId, data: { id: bodyId } }),
  });
}

function gateway(overrides: Record<string, unknown> = {}) {
  return {
    verifyWebhookSignature: vi.fn(() => true),
    parseWebhookEvent: vi.fn(() => ({
      eventId: "event-123",
      providerAccountId: "seller-123",
      paymentExternalId: "pay-123",
    })),
    getPayment: vi.fn().mockResolvedValue({
      externalId: "pay-123",
      status: "APPROVED",
      amount: 100,
      method: "pix",
      externalReference: ORDER_ID,
      currency: "BRL",
      providerAccountId: "seller-123",
    }),
    ...overrides,
  };
}

describe("POST /api/webhooks/mercadopago", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getPaymentCredentials).mockResolvedValue({
      accessToken: "vault-token",
      refreshToken: null,
      providerAccountId: "seller-123",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("rejeita assinatura ausente/inválida antes de tocar o banco", async () => {
    const mp = gateway({ verifyWebhookSignature: vi.fn(() => false) });
    const supabase = fakeSupabase();
    vi.mocked(getGateway).mockReturnValue(mp as never);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);

    const response = await POST(webhookRequest());

    expect(response.status).toBe(401);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("usa data.id da query na assinatura e rejeita divergência com o corpo", async () => {
    const mp = gateway({
      parseWebhookEvent: vi.fn(() => ({
        eventId: "event-123",
        providerAccountId: "seller-123",
        paymentExternalId: "body-other",
      })),
    });
    const supabase = fakeSupabase();
    vi.mocked(getGateway).mockReturnValue(mp as never);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);

    const response = await POST(webhookRequest({ queryId: "query-authoritative", bodyId: "body-other" }));

    expect(mp.verifyWebhookSignature).toHaveBeenCalledWith(expect.any(Headers), expect.any(String), "query-authoritative");
    expect(response.status).toBe(400);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("entrega duplicada já processada retorna 200 sem consultar o provedor nem reaplicar", async () => {
    const mp = gateway();
    const supabase = fakeSupabase({
      insertError: { code: "23505" },
      existing: { processed_at: "2026-10-13T12:00:00.000Z" },
    });
    vi.mocked(getGateway).mockReturnValue(mp as never);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mp.getPayment).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("pagamento confirmado pelo provedor com tenant, pedido, moeda, vendedor e valor coerentes é aplicado uma vez", async () => {
    const mp = gateway();
    const supabase = fakeSupabase();
    vi.mocked(getGateway).mockReturnValue(mp as never);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mp.getPayment).toHaveBeenCalledWith("vault-token", "pay-123");
    expect(supabase.rpc).toHaveBeenCalledWith("apply_payment_update", {
      p_tenant_id: TENANT_ID,
      p_order_id: ORDER_ID,
      p_provider: "mercadopago",
      p_external_id: "pay-123",
      p_status: "APPROVED",
      p_method: "pix",
      p_amount: 100,
    });
    expect(supabase.eventsUpdate).toHaveBeenCalledWith(expect.objectContaining({ processed_at: expect.any(String) }));
  });

  it.each([
    ["identificador do pagamento", { externalId: "pay-other" }, {}],
    ["moeda", { currency: "USD" }, {}],
    ["vendedor/tenant", { providerAccountId: "seller-other" }, {}],
    ["valor", {}, { localPayment: { amount: 99 } }],
    ["pedido inexistente no tenant", {}, { localPayment: null }],
  ])("não aplica nem marca processado quando há divergência de %s", async (_label, paymentPatch, dbPatch) => {
    const mp = gateway({
      getPayment: vi.fn().mockResolvedValue({
        externalId: "pay-123",
        status: "APPROVED",
        amount: 100,
        method: "pix",
        externalReference: ORDER_ID,
        currency: "BRL",
        providerAccountId: "seller-123",
        ...paymentPatch,
      }),
    });
    const supabase = fakeSupabase(dbPatch);
    vi.mocked(getGateway).mockReturnValue(mp as never);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.eventsUpdate).not.toHaveBeenCalled();
  });

  it("timeout do provedor mantém o evento pendente e devolve 503 para permitir retry", async () => {
    const mp = gateway({ getPayment: vi.fn().mockRejectedValue(new Error("mercadopago: timed out after 10000ms")) });
    const supabase = fakeSupabase();
    vi.mocked(getGateway).mockReturnValue(mp as never);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);

    const response = await POST(webhookRequest());

    expect(response.status).toBe(503);
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.eventsUpdate).not.toHaveBeenCalled();
  });

  it("falha ao aplicar no PostgreSQL mantém o evento pendente e devolve 503", async () => {
    const mp = gateway();
    const supabase = fakeSupabase({ applyError: { message: "db unavailable" } });
    vi.mocked(getGateway).mockReturnValue(mp as never);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);

    const response = await POST(webhookRequest());

    expect(response.status).toBe(503);
    expect(supabase.eventsUpdate).not.toHaveBeenCalled();
  });
});
