import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAsaasGateway } from "@/lib/billing/asaas";
import { BillingGatewayError } from "@/lib/billing/gateway";

const API_KEY = "$aact_test_super_secret_key_never_leak_me";
const BASE_URL = "https://sandbox.asaas.com/api/v3";

describe("createAsaasGateway (mocked fetch — no real network call, no real Asaas account touched)", () => {
  const originalFetch = global.fetch;
  const gateway = createAsaasGateway(API_KEY, BASE_URL);

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("authentication", () => {
    it("sends the API key in the `access_token` header, never as Authorization: Bearer", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "cus_1", name: "Loja X", email: "x@x.com", externalReference: "tenant-1" }), { status: 200 }),
      );
      await gateway.getCustomer("cus_1");
      const [calledUrl, init] = vi.mocked(global.fetch).mock.calls[0]!;
      expect(calledUrl).toBe(`${BASE_URL}/customers/cus_1`);
      const headers = init!.headers as Record<string, string>;
      expect(headers.access_token).toBe(API_KEY);
      expect(headers.authorization).toBeUndefined();
      expect(headers["content-type"]).toBe("application/json");
    });
  });

  describe("createCustomer", () => {
    it("posts to /customers and maps the response, using externalReference as the tenant anchor", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "cus_123", name: "SuperBrands", email: "dono@superbrands.com", externalReference: "tenant-abc" }),
          { status: 200 },
        ),
      );
      const customer = await gateway.createCustomer({
        name: "SuperBrands",
        email: "dono@superbrands.com",
        externalReference: "tenant-abc",
      });
      expect(customer).toEqual({ id: "cus_123", name: "SuperBrands", email: "dono@superbrands.com", externalReference: "tenant-abc" });
      const [calledUrl, init] = vi.mocked(global.fetch).mock.calls[0]!;
      expect(calledUrl).toBe(`${BASE_URL}/customers`);
      expect(init!.method).toBe("POST");
      const body = JSON.parse(init!.body as string);
      expect(body).toMatchObject({ name: "SuperBrands", email: "dono@superbrands.com", externalReference: "tenant-abc" });
    });
  });

  describe("getCustomer", () => {
    it("returns the mapped customer when found", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "cus_1", name: "Loja X", email: "x@x.com", externalReference: null }), { status: 200 }),
      );
      const customer = await gateway.getCustomer("cus_1");
      expect(customer).toEqual({ id: "cus_1", name: "Loja X", email: "x@x.com", externalReference: null });
    });

    it("returns null (never throws) when the gateway responds 404", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ code: "invalid_customer", description: "Cliente não encontrado" }] }), { status: 404 }),
      );
      const customer = await gateway.getCustomer("cus_missing");
      expect(customer).toBeNull();
    });
  });

  describe("createSubscription", () => {
    it("normalizes VEXO's own vocabulary (pix/card, monthly/yearly) into Asaas's (PIX/CREDIT_CARD, MONTHLY/YEARLY)", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "sub_1",
            customer: "cus_123",
            status: "ACTIVE",
            billingType: "PIX",
            cycle: "MONTHLY",
            value: 49.9,
            nextDueDate: "2026-09-01",
            externalReference: "tenant-abc",
          }),
          { status: 200 },
        ),
      );
      const subscription = await gateway.createSubscription({
        customerId: "cus_123",
        billingType: "pix",
        cycle: "monthly",
        value: 49.9,
        nextDueDate: "2026-09-01",
        externalReference: "tenant-abc",
      });
      expect(subscription.id).toBe("sub_1");
      expect(subscription.status).toBe("ACTIVE");
      const [calledUrl, init] = vi.mocked(global.fetch).mock.calls[0]!;
      expect(calledUrl).toBe(`${BASE_URL}/subscriptions`);
      const body = JSON.parse(init!.body as string);
      expect(body).toMatchObject({ customer: "cus_123", billingType: "PIX", cycle: "MONTHLY", value: 49.9, externalReference: "tenant-abc" });
    });
  });

  describe("getSubscription", () => {
    it("returns the mapped subscription when found", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "sub_1",
            customer: "cus_123",
            status: "ACTIVE",
            billingType: "CREDIT_CARD",
            cycle: "MONTHLY",
            value: 99.9,
            nextDueDate: "2026-09-01",
            externalReference: "tenant-abc",
          }),
          { status: 200 },
        ),
      );
      const subscription = await gateway.getSubscription("sub_1");
      expect(subscription).toMatchObject({ id: "sub_1", customerId: "cus_123", value: 99.9 });
    });

    it("returns null on 404", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ errors: [] }), { status: 404 }));
      expect(await gateway.getSubscription("sub_missing")).toBeNull();
    });
  });

  describe("listSubscriptionPayments", () => {
    it("GETs /subscriptions/{id}/payments and maps every payment in the list envelope", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            object: "list",
            hasMore: false,
            totalCount: 2,
            data: [
              { id: "pay_1", subscription: "sub_1", customer: "cus_123", status: "PENDING", value: 49.9, billingType: "PIX", dueDate: "2026-09-01", paymentDate: null },
              { id: "pay_2", subscription: "sub_1", customer: "cus_123", status: "PENDING", value: 49.9, billingType: "PIX", dueDate: "2026-10-01", paymentDate: null },
            ],
          }),
          { status: 200 },
        ),
      );
      const payments = await gateway.listSubscriptionPayments("sub_1");
      expect(payments).toHaveLength(2);
      expect(payments[0]).toMatchObject({ id: "pay_1", subscriptionId: "sub_1", dueDate: "2026-09-01" });
      const [calledUrl] = vi.mocked(global.fetch).mock.calls[0]!;
      expect(calledUrl).toBe(`${BASE_URL}/subscriptions/sub_1/payments`);
    });

    it("returns an empty array when the subscription has no payments yet", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ object: "list", data: [] }), { status: 200 }));
      expect(await gateway.listSubscriptionPayments("sub_1")).toEqual([]);
    });
  });

  describe("updateSubscription", () => {
    it("sends a PUT with only the provided fields, normalized", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "sub_1",
            customer: "cus_123",
            status: "ACTIVE",
            billingType: "PIX",
            cycle: "YEARLY",
            value: 499,
            nextDueDate: "2026-10-01",
            externalReference: "tenant-abc",
          }),
          { status: 200 },
        ),
      );
      const subscription = await gateway.updateSubscription("sub_1", { cycle: "yearly", value: 499 });
      expect(subscription.cycle).toBe("YEARLY");
      const [calledUrl, init] = vi.mocked(global.fetch).mock.calls[0]!;
      expect(calledUrl).toBe(`${BASE_URL}/subscriptions/sub_1`);
      expect(init!.method).toBe("PUT");
      const body = JSON.parse(init!.body as string);
      expect(body).toMatchObject({ value: 499, cycle: "YEARLY" });
    });
  });

  describe("cancelSubscription", () => {
    it("sends a DELETE and resolves with no value on a 200/204 response", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
      await expect(gateway.cancelSubscription("sub_1")).resolves.toBeUndefined();
      const [calledUrl, init] = vi.mocked(global.fetch).mock.calls[0]!;
      expect(calledUrl).toBe(`${BASE_URL}/subscriptions/sub_1`);
      expect(init!.method).toBe("DELETE");
    });
  });

  describe("getPayment", () => {
    it("returns the mapped payment when found", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "pay_1",
            subscription: "sub_1",
            customer: "cus_123",
            status: "CONFIRMED",
            value: 49.9,
            billingType: "PIX",
            dueDate: "2026-09-01",
            paymentDate: "2026-09-01",
          }),
          { status: 200 },
        ),
      );
      const payment = await gateway.getPayment("pay_1");
      expect(payment).toMatchObject({ id: "pay_1", subscriptionId: "sub_1", status: "CONFIRMED" });
    });

    it("returns null on 404", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ errors: [] }), { status: 404 }));
      expect(await gateway.getPayment("pay_missing")).toBeNull();
    });
  });

  describe("HTTP error handling", () => {
    it("400 Bad Request → BillingGatewayError with code BAD_REQUEST, not retryable", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ code: "invalid_email", description: "E-mail inválido" }] }), { status: 400 }),
      );
      await expect(gateway.createCustomer({ name: "X", email: "bad", externalReference: "t1" })).rejects.toMatchObject({
        name: "BillingGatewayError",
        status: 400,
        code: "BAD_REQUEST",
        retryable: false,
      });
    });

    it("401 Unauthorized → code UNAUTHORIZED, not retryable", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ description: "Invalid api key" }] }), { status: 401 }));
      await expect(gateway.getCustomer("cus_1")).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401, retryable: false });
    });

    it("403 Forbidden → code FORBIDDEN, not retryable", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ errors: [] }), { status: 403 }));
      await expect(gateway.getCustomer("cus_1")).rejects.toMatchObject({ code: "FORBIDDEN", status: 403, retryable: false });
    });

    it("429 Too Many Requests → code RATE_LIMITED, retryable", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ errors: [] }), { status: 429 }));
      await expect(gateway.getCustomer("cus_1")).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429, retryable: true });
    });

    it("5xx Server Error → code SERVER_ERROR, retryable", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ errors: [] }), { status: 502 }));
      await expect(gateway.getCustomer("cus_1")).rejects.toMatchObject({ code: "SERVER_ERROR", status: 502, retryable: true });
    });

    it("includes the gateway's own error description in the thrown message when present", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ code: "invalid_customer", description: "Cliente não encontrado" }] }), { status: 404 }),
      );
      await expect(gateway.getSubscription("sub_x")).resolves.toBeNull(); // getSubscription swallows 404 into null
      // A chamada de createSubscription NÃO trata 404 como null (não é um "getOrNull") — usada aqui só para
      // verificar que a descrição do gateway chega na mensagem quando o erro de fato propaga.
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ code: "invalid_customer", description: "Cliente não encontrado" }] }), { status: 400 }),
      );
      await expect(gateway.createSubscription({
        customerId: "cus_missing",
        billingType: "card",
        cycle: "monthly",
        value: 10,
        nextDueDate: "2026-09-01",
        externalReference: "tenant-x",
      })).rejects.toThrow(/Cliente não encontrado/);
    });
  });

  describe("network failures", () => {
    it("timeout → BillingGatewayError with code TIMEOUT, retryable", async () => {
      global.fetch = vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }) as unknown as typeof fetch;

      const fastTimeoutGateway = createAsaasGateway(API_KEY, BASE_URL, 5);
      await expect(fastTimeoutGateway.getCustomer("cus_1")).rejects.toMatchObject({
        name: "BillingGatewayError",
        code: "TIMEOUT",
        status: null,
        retryable: true,
      });
    });

    it("network error (fetch rejects with a non-abort error) → code NETWORK_ERROR, retryable", async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND"));
      await expect(gateway.getCustomer("cus_1")).rejects.toMatchObject({ code: "NETWORK_ERROR", status: null, retryable: true });
    });

    it("malformed (non-JSON) response body → code INVALID_RESPONSE", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(new Response("<html>not json</html>", { status: 200 }));
      await expect(gateway.getCustomer("cus_1")).rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 200 });
    });
  });

  describe("API key never leaks", () => {
    it("never appears in a thrown error's message across every error path", async () => {
      const scenarios: Array<() => Promise<unknown>> = [
        () => {
          vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ description: "bad" }] }), { status: 400 }));
          return gateway.getCustomer("cus_1");
        },
        () => {
          vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ errors: [] }), { status: 401 }));
          return gateway.getCustomer("cus_1");
        },
        () => {
          vi.mocked(global.fetch).mockResolvedValueOnce(new Response("not json", { status: 200 }));
          return gateway.getCustomer("cus_1");
        },
        () => {
          vi.mocked(global.fetch).mockRejectedValueOnce(new Error("network down"));
          return gateway.getCustomer("cus_1");
        },
      ];

      for (const run of scenarios) {
        try {
          await run();
          throw new Error("expected the scenario to reject");
        } catch (err) {
          expect(err).toBeInstanceOf(BillingGatewayError);
          const serialized = `${(err as Error).message} ${JSON.stringify(err)}`;
          expect(serialized).not.toContain(API_KEY);
        }
      }
    });
  });
});
