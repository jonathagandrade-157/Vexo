import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * JON-15 — `reconcileStalePendingPayments` (lib/payments/reconcile.ts),
 * a rede de segurança contra webhook do Mercado Pago perdido. Mesmo
 * padrão de `tests/unit/melhor-envio-checkout.test.ts`: Supabase, o
 * gateway (via registry) e o vault totalmente mockados — nenhuma chamada
 * real de rede/banco.
 */
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/payments/registry", () => ({ getGateway: vi.fn() }));
vi.mock("@/lib/payments/vault", () => ({ getPaymentCredentials: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import * as Sentry from "@sentry/nextjs";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { getGateway } from "@/lib/payments/registry";
import { getPaymentCredentials } from "@/lib/payments/vault";
import { reconcileStalePendingPayments } from "@/lib/payments/reconcile";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const ORDER_A = "33333333-3333-3333-3333-333333333333";
const ORDER_B = "44444444-4444-4444-4444-444444444444";

function fakeSupabase(staleOrders: Array<{ tenant_id: string; order_id: string }>, listError: unknown = null) {
  const rpc = vi.fn((name: string) => {
    if (name === "list_stale_pending_gateway_payments") {
      return Promise.resolve({ data: listError ? null : staleOrders, error: listError });
    }
    if (name === "apply_payment_update") {
      return Promise.resolve({ data: null, error: null });
    }
    throw new Error(`unexpected rpc: ${name}`);
  });
  return { rpc };
}

describe("reconcileStalePendingPayments (JON-15)", () => {
  afterEach(() => {
    vi.mocked(createSupabaseServiceRoleClient).mockReset();
    vi.mocked(getGateway).mockReset();
    vi.mocked(getPaymentCredentials).mockReset();
    vi.mocked(Sentry.captureException).mockReset();
    vi.mocked(Sentry.captureMessage).mockReset();
  });

  it("no stale orders found → checked=0, reconciled=0, no writes, no Sentry signal", async () => {
    const supabase = fakeSupabase([]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);
    vi.mocked(getGateway).mockReturnValue({ searchPaymentByExternalReference: vi.fn() } as never);

    const result = await reconcileStalePendingPayments();

    expect(result).toEqual({ checked: 0, reconciled: 0 });
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("list_stale_pending_gateway_payments RPC error → reports via Sentry.captureException, returns zeroed result, never throws", async () => {
    const supabase = fakeSupabase([], { message: "db unavailable" });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);
    vi.mocked(getGateway).mockReturnValue({ searchPaymentByExternalReference: vi.fn() } as never);

    const result = await reconcileStalePendingPayments();

    expect(result).toEqual({ checked: 0, reconciled: 0 });
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect((Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls[0]![0].message).toMatch(/list_stale_pending_gateway_payments/);
  });

  it("a definitive APPROVED result found → calls apply_payment_update and increments reconciled", async () => {
    const supabase = fakeSupabase([{ tenant_id: TENANT_A, order_id: ORDER_A }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);
    vi.mocked(getPaymentCredentials).mockResolvedValue({ accessToken: "token-a", refreshToken: null });
    const searchPaymentByExternalReference = vi.fn().mockResolvedValue({
      externalId: "mp-payment-1",
      status: "APPROVED",
      amount: 100,
      method: "pix",
      externalReference: ORDER_A,
    });
    vi.mocked(getGateway).mockReturnValue({ searchPaymentByExternalReference } as never);

    const result = await reconcileStalePendingPayments();

    expect(result).toEqual({ checked: 1, reconciled: 1 });
    expect(searchPaymentByExternalReference).toHaveBeenCalledWith("token-a", ORDER_A);
    expect(supabase.rpc).toHaveBeenCalledWith("apply_payment_update", {
      p_tenant_id: TENANT_A,
      p_order_id: ORDER_A,
      p_provider: "mercadopago",
      p_external_id: "mp-payment-1",
      p_status: "APPROVED",
      p_method: "pix",
      p_amount: 100,
    });
  });

  it("a definitive REJECTED result found → also reconciled, not only APPROVED (aprovação condição #2 do ticket)", async () => {
    const supabase = fakeSupabase([{ tenant_id: TENANT_A, order_id: ORDER_A }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);
    vi.mocked(getPaymentCredentials).mockResolvedValue({ accessToken: "token-a", refreshToken: null });
    const searchPaymentByExternalReference = vi.fn().mockResolvedValue({
      externalId: "mp-payment-2",
      status: "REJECTED",
      amount: 100,
      method: "pix",
      externalReference: ORDER_A,
    });
    vi.mocked(getGateway).mockReturnValue({ searchPaymentByExternalReference } as never);

    const result = await reconcileStalePendingPayments();

    expect(result).toEqual({ checked: 1, reconciled: 1 });
    expect(supabase.rpc).toHaveBeenCalledWith("apply_payment_update", expect.objectContaining({ p_status: "REJECTED" }));
  });

  it.each(["CANCELLED", "REFUNDED"] as const)(
    "a definitive %s result found → also reconciled",
    async (status) => {
      const supabase = fakeSupabase([{ tenant_id: TENANT_A, order_id: ORDER_A }]);
      vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);
      vi.mocked(getPaymentCredentials).mockResolvedValue({ accessToken: "token-a", refreshToken: null });
      const searchPaymentByExternalReference = vi.fn().mockResolvedValue({
        externalId: "mp-payment-3",
        status,
        amount: 100,
        method: "pix",
        externalReference: ORDER_A,
      });
      vi.mocked(getGateway).mockReturnValue({ searchPaymentByExternalReference } as never);

      const result = await reconcileStalePendingPayments();

      expect(result).toEqual({ checked: 1, reconciled: 1 });
      expect(supabase.rpc).toHaveBeenCalledWith("apply_payment_update", expect.objectContaining({ p_status: status }));
    },
  );

  it("search result is null (nothing found yet) → skipped, never calls apply_payment_update, not counted as reconciled", async () => {
    const supabase = fakeSupabase([{ tenant_id: TENANT_A, order_id: ORDER_A }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);
    vi.mocked(getPaymentCredentials).mockResolvedValue({ accessToken: "token-a", refreshToken: null });
    const searchPaymentByExternalReference = vi.fn().mockResolvedValue(null);
    vi.mocked(getGateway).mockReturnValue({ searchPaymentByExternalReference } as never);

    const result = await reconcileStalePendingPayments();

    expect(result).toEqual({ checked: 1, reconciled: 0 });
    expect(supabase.rpc).not.toHaveBeenCalledWith("apply_payment_update", expect.anything());
  });

  it("search result is still PENDING at Mercado Pago (order genuinely in progress) → skipped, not a lost webhook", async () => {
    const supabase = fakeSupabase([{ tenant_id: TENANT_A, order_id: ORDER_A }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);
    vi.mocked(getPaymentCredentials).mockResolvedValue({ accessToken: "token-a", refreshToken: null });
    const searchPaymentByExternalReference = vi.fn().mockResolvedValue({
      externalId: "mp-payment-4",
      status: "PENDING",
      amount: 100,
      method: "pix",
      externalReference: ORDER_A,
    });
    vi.mocked(getGateway).mockReturnValue({ searchPaymentByExternalReference } as never);

    const result = await reconcileStalePendingPayments();

    expect(result).toEqual({ checked: 1, reconciled: 0 });
    expect(supabase.rpc).not.toHaveBeenCalledWith("apply_payment_update", expect.anything());
  });

  it("no stored credentials for the tenant (gateway disconnected meanwhile) → skipped without error", async () => {
    const supabase = fakeSupabase([{ tenant_id: TENANT_A, order_id: ORDER_A }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);
    vi.mocked(getPaymentCredentials).mockResolvedValue(null);
    const searchPaymentByExternalReference = vi.fn();
    vi.mocked(getGateway).mockReturnValue({ searchPaymentByExternalReference } as never);

    const result = await reconcileStalePendingPayments();

    expect(result).toEqual({ checked: 1, reconciled: 0 });
    expect(searchPaymentByExternalReference).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("one order's Mercado Pago lookup throws → isolated per-order (try/catch): reported via Sentry.captureException with tenantId/orderId, never blocks the other orders in the same run", async () => {
    const supabase = fakeSupabase([
      { tenant_id: TENANT_A, order_id: ORDER_A },
      { tenant_id: TENANT_B, order_id: ORDER_B },
    ]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);
    vi.mocked(getPaymentCredentials).mockResolvedValue({ accessToken: "token", refreshToken: null });
    const searchPaymentByExternalReference = vi.fn().mockImplementation((_token: string, orderId: string) => {
      if (orderId === ORDER_A) throw new Error("mercadopago: network error");
      return Promise.resolve({
        externalId: "mp-payment-5",
        status: "APPROVED",
        amount: 50,
        method: "pix",
        externalReference: ORDER_B,
      });
    });
    vi.mocked(getGateway).mockReturnValue({ searchPaymentByExternalReference } as never);

    const result = await reconcileStalePendingPayments();

    expect(result).toEqual({ checked: 2, reconciled: 1 });
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect((Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toEqual({
      extra: { tenantId: TENANT_A, orderId: ORDER_A },
    });
  });

  it("apply_payment_update RPC error for one order → caught, reported, does not abort the batch", async () => {
    const supabase = fakeSupabase([{ tenant_id: TENANT_A, order_id: ORDER_A }]);
    vi.mocked(supabase.rpc).mockImplementation((name: string) => {
      if (name === "list_stale_pending_gateway_payments") {
        return Promise.resolve({ data: [{ tenant_id: TENANT_A, order_id: ORDER_A }], error: null });
      }
      return Promise.resolve({ data: null, error: { message: "constraint violation" } });
    });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);
    vi.mocked(getPaymentCredentials).mockResolvedValue({ accessToken: "token-a", refreshToken: null });
    const searchPaymentByExternalReference = vi.fn().mockResolvedValue({
      externalId: "mp-payment-6",
      status: "APPROVED",
      amount: 100,
      method: "pix",
      externalReference: ORDER_A,
    });
    vi.mocked(getGateway).mockReturnValue({ searchPaymentByExternalReference } as never);

    const result = await reconcileStalePendingPayments();

    expect(result).toEqual({ checked: 1, reconciled: 0 });
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it("reconciled > 0 → fires Sentry.captureMessage at 'warning' level with the count (webhook-health signal)", async () => {
    const supabase = fakeSupabase([{ tenant_id: TENANT_A, order_id: ORDER_A }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);
    vi.mocked(getPaymentCredentials).mockResolvedValue({ accessToken: "token-a", refreshToken: null });
    vi.mocked(getGateway).mockReturnValue({
      searchPaymentByExternalReference: vi.fn().mockResolvedValue({
        externalId: "mp-payment-7",
        status: "APPROVED",
        amount: 100,
        method: "pix",
        externalReference: ORDER_A,
      }),
    } as never);

    await reconcileStalePendingPayments();

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [message, options] = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(message).toMatch(/1/);
    expect(options).toEqual({ level: "warning", extra: { checked: 1, reconciled: 1 } });
  });
});
