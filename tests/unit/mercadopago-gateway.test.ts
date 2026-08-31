import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMercadoPagoGateway } from "@/lib/payments/mercadopago";

const CLIENT_ID = "test-client-id";
const CLIENT_SECRET = "test-client-secret";
const WEBHOOK_SECRET = "test-webhook-secret";

const gateway = createMercadoPagoGateway(CLIENT_ID, CLIENT_SECRET, WEBHOOK_SECRET);

describe("getAuthorizeUrl", () => {
  it("builds a real Mercado Pago authorization URL with state and redirect_uri", () => {
    const url = new URL(gateway.getAuthorizeUrl("signed-state", "https://loja.vexo.local/api/oauth/mercadopago/callback"));
    expect(url.origin + url.pathname).toBe("https://auth.mercadopago.com/authorization");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("signed-state");
    expect(url.searchParams.get("redirect_uri")).toBe("https://loja.vexo.local/api/oauth/mercadopago/callback");
  });
});

describe("verifyWebhookSignature", () => {
  function buildHeaders(dataId: string, requestId: string, ts: string, secret: string) {
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
    return new Headers({ "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId });
  }

  it("accepts a correctly signed payload", () => {
    const rawBody = JSON.stringify({ data: { id: "12345" } });
    const headers = buildHeaders("12345", "req-1", "1700000000", WEBHOOK_SECRET);
    expect(gateway.verifyWebhookSignature(headers, rawBody)).toBe(true);
  });

  it("rejects a payload signed with the wrong secret", () => {
    const rawBody = JSON.stringify({ data: { id: "12345" } });
    const headers = buildHeaders("12345", "req-1", "1700000000", "wrong-secret");
    expect(gateway.verifyWebhookSignature(headers, rawBody)).toBe(false);
  });

  it("rejects a tampered body (data.id changed after signing)", () => {
    const headers = buildHeaders("12345", "req-1", "1700000000", WEBHOOK_SECRET);
    const tamperedBody = JSON.stringify({ data: { id: "99999" } });
    expect(gateway.verifyWebhookSignature(headers, tamperedBody)).toBe(false);
  });

  it("rejects a request missing the signature header", () => {
    const headers = new Headers({ "x-request-id": "req-1" });
    expect(gateway.verifyWebhookSignature(headers, JSON.stringify({ data: { id: "1" } }))).toBe(false);
  });

  it("rejects a request missing the request-id header", () => {
    const headers = new Headers({ "x-signature": "ts=1,v1=deadbeef" });
    expect(gateway.verifyWebhookSignature(headers, JSON.stringify({ data: { id: "1" } }))).toBe(false);
  });

  it("rejects malformed JSON body", () => {
    const headers = buildHeaders("12345", "req-1", "1700000000", WEBHOOK_SECRET);
    expect(gateway.verifyWebhookSignature(headers, "not json")).toBe(false);
  });
});

describe("parseWebhookEvent", () => {
  it("extracts eventId/providerAccountId/paymentExternalId from a valid payment notification", () => {
    const headers = new Headers({ "x-request-id": "req-1" });
    const event = gateway.parseWebhookEvent(headers, { id: 555, user_id: 42, data: { id: "999" } });
    expect(event).toEqual({ eventId: "555", providerAccountId: "42", paymentExternalId: "999" });
  });

  it("returns null when data.id is missing (nothing to look up)", () => {
    const headers = new Headers({ "x-request-id": "req-1" });
    expect(gateway.parseWebhookEvent(headers, { id: 555, user_id: 42 })).toBeNull();
  });

  it("returns null for a non-object payload", () => {
    const headers = new Headers();
    expect(gateway.parseWebhookEvent(headers, null)).toBeNull();
    expect(gateway.parseWebhookEvent(headers, "a string")).toBeNull();
  });
});

describe("fetch-backed operations (mocked fetch — no real network call)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("exchangeCodeForTokens posts to the real MP token endpoint and maps the response", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", user_id: 777, expires_in: 3600 }), {
        status: 200,
      }),
    );
    const tokens = await gateway.exchangeCodeForTokens("auth-code", "https://loja.vexo.local/callback");
    expect(tokens).toEqual({
      accessToken: "at",
      refreshToken: "rt",
      providerAccountId: "777",
      expiresAt: expect.any(Date),
    });
    const [calledUrl, init] = vi.mocked(global.fetch).mock.calls[0]!;
    expect(calledUrl).toBe("https://api.mercadopago.com/oauth/token");
    expect(JSON.parse(init!.body as string)).toMatchObject({ client_id: CLIENT_ID, code: "auth-code" });
  });

  it("exchangeCodeForTokens throws on a non-ok response, never swallowing the failure", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response("", { status: 400 }));
    await expect(gateway.exchangeCodeForTokens("bad-code", "https://x/callback")).rejects.toThrow();
  });

  it("createPayment sends orders.total as unit_price and external_reference = orderId — never a client-supplied value", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "pref-1", init_point: "https://mp.example/checkout/pref-1" }), { status: 201 }),
    );
    const result = await gateway.createPayment({
      accessToken: "seller-token",
      orderId: "order-abc",
      orderNumber: "PED000123",
      amount: 199.9,
      customerEmail: "cliente@example.com",
      backUrl: "https://loja.vexo.local/pedido/order-abc",
      notificationUrl: "https://loja.vexo.local/api/webhooks/mercadopago",
    });
    expect(result).toEqual({ externalId: "pref-1", checkoutUrl: "https://mp.example/checkout/pref-1" });
    const [, init] = vi.mocked(global.fetch).mock.calls[0]!;
    const body = JSON.parse(init!.body as string);
    expect(body.external_reference).toBe("order-abc");
    expect(body.items[0].unit_price).toBe(199.9);
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer seller-token");
  });

  it("getPayment maps Mercado Pago status strings to the normalized enum", async () => {
    const cases: [string, string][] = [
      ["approved", "APPROVED"],
      ["rejected", "REJECTED"],
      ["cancelled", "CANCELLED"],
      ["refunded", "REFUNDED"],
      ["charged_back", "REFUNDED"],
      ["pending", "PENDING"],
      ["in_process", "PENDING"],
    ];
    for (const [mpStatus, expected] of cases) {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 1, status: mpStatus, transaction_amount: 10, payment_method_id: "pix", external_reference: "order-x" }),
          { status: 200 },
        ),
      );
      const payment = await gateway.getPayment("token", "1");
      expect(payment.status).toBe(expected);
    }
  });
});

/**
 * D9.1 — as 4 chamadas HTTP reais do gateway (exchangeCodeForTokens,
 * createPayment, getPayment, refundPayment) passam a usar um
 * AbortController interno com timeout fixo (mesmo padrão de
 * lib/billing/asaas.ts). Nunca simula o timeout de verdade esperando
 * 10s: em vez disso, faz `fetch` rejeitar como o próprio runtime faria
 * quando `controller.abort()` dispara (`AbortError`), o que já exercita
 * o branch de conversão de erro sem deixar o teste lento.
 */
describe("timeout / AbortController (D9.1)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function abortError(): Error {
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    return err;
  }

  it("1. uma chamada normal continua funcionando (getPayment)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: 1, status: "approved", transaction_amount: 42, payment_method_id: "pix", external_reference: "order-x" }),
        { status: 200 },
      ),
    );
    const payment = await gateway.getPayment("token", "1");
    expect(payment.status).toBe("APPROVED");
  });

  it("2. uma chamada abortada (timeout) produz um erro tratado, nunca uma promise pendurada", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(abortError());
    await expect(gateway.getPayment("token", "1")).rejects.toThrow(/timed out after 10000ms/);
  });

  it("2b. timeout em exchangeCodeForTokens também produz erro tratado (não só getPayment)", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(abortError());
    await expect(gateway.exchangeCodeForTokens("code", "https://x/callback")).rejects.toThrow(/timed out/);
  });

  it("2c. timeout em createPayment também produz erro tratado", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(abortError());
    await expect(
      gateway.createPayment({
        accessToken: "seller-token",
        orderId: "order-abc",
        orderNumber: "PED000123",
        amount: 10,
        customerEmail: "cliente@example.com",
        backUrl: "https://loja.vexo.local/pedido/order-abc",
        notificationUrl: "https://loja.vexo.local/api/webhooks/mercadopago",
      }),
    ).rejects.toThrow(/timed out/);
  });

  it("2d. timeout em refundPayment também produz erro tratado", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(abortError());
    await expect(gateway.refundPayment("seller-token", "payment-1")).rejects.toThrow(/timed out/);
  });

  it("3. o AbortController é realmente conectado ao fetch (signal presente e é um AbortSignal)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: 1, status: "approved", transaction_amount: 1, payment_method_id: null, external_reference: null }), { status: 200 }));
    await gateway.getPayment("token", "1");
    const [, init] = vi.mocked(global.fetch).mock.calls[0]!;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("4. nenhum segredo (client secret, webhook secret, access token) aparece na mensagem de erro de timeout ou rede", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(abortError());
    try {
      await gateway.createPayment({
        accessToken: "super-secret-seller-token",
        orderId: "order-abc",
        orderNumber: "PED000123",
        amount: 10,
        customerEmail: "cliente@example.com",
        backUrl: "https://loja.vexo.local/pedido/order-abc",
        notificationUrl: "https://loja.vexo.local/api/webhooks/mercadopago",
      });
      throw new Error("expected createPayment to reject");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain(CLIENT_SECRET);
      expect(message).not.toContain(WEBHOOK_SECRET);
      expect(message).not.toContain("super-secret-seller-token");
    }
  });

  it("5. um erro de rede genérico (não-abort) também é convertido, sem vazar detalhe interno", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(gateway.getPayment("token", "1")).rejects.toThrow(/network error/);
  });

  it("6. uma resposta HTTP de erro (não-timeout) continua com o comportamento anterior — mensagem específica do endpoint", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response("", { status: 500 }));
    await expect(gateway.getPayment("token", "1")).rejects.toThrow(/get payment failed \(500\)/);
  });
});
