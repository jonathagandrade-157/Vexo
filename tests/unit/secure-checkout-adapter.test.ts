import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceRoleClient: vi.fn() }));

import { createOwnedOrder } from "@/features/checkout/create-owned-order";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

const baseInput = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  cartId: "22222222-2222-4222-8222-222222222222",
  ownerTokenHash: "a".repeat(64),
  customerName: "Cliente",
  customerEmail: "cliente@example.com",
  customerPhone: "+5511999999999",
  shippingAddress: null,
  orderSource: "vexo_checkout" as const,
  paymentChannel: "gateway" as const,
  requestedPaymentMethod: null,
  cashChangeFor: null,
};

describe("secure checkout BFF adapter", () => {
  afterEach(() => vi.resetAllMocks());

  it("calls only the service-role RPC and passes the ownership hash", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { orderId: "order-1", created: true }, error: null });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue({ rpc } as never);

    await expect(createOwnedOrder({ ...baseInput, shipping: { kind: "none" } })).resolves.toEqual({
      ok: true,
      orderId: "order-1",
      created: true,
    });
    expect(rpc).toHaveBeenCalledWith(
      "checkout_cart_secure",
      expect.objectContaining({
        p_cart_id: baseInput.cartId,
        p_tenant_id: baseInput.tenantId,
        p_owner_token_hash: baseInput.ownerTokenHash,
        p_order_source: "vexo_checkout",
        p_payment_channel: "gateway",
        p_shipping_kind: "none",
      }),
    );
  });

  it("passes only server-verified Melhor Envio values", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { orderId: "order-1", created: false }, error: null });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue({ rpc } as never);

    await createOwnedOrder({
      ...baseInput,
      shipping: { kind: "melhor_envio", serviceId: "2", name: "SEDEX", price: 35.5, estimatedDays: 3 },
    });

    expect(rpc).toHaveBeenCalledWith(
      "checkout_cart_secure",
      expect.objectContaining({
        p_shipping_kind: "melhor_envio",
        p_me_service_id: "2",
        p_me_service_name: "SEDEX",
        p_me_price: 35.5,
        p_me_estimated_days: 3,
      }),
    );
  });

  it("does not hide PostgreSQL authorization or shipping failures", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "cart ownership could not be verified" } });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue({ rpc } as never);

    await expect(createOwnedOrder({ ...baseInput, shipping: { kind: "none" } })).resolves.toEqual({
      ok: false,
      error: "cart ownership could not be verified",
    });
  });
});
