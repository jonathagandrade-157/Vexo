import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/cart/cart-cookie", () => ({ getCartCredentials: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceRoleClient: vi.fn() }));

import { getCartCredentials } from "@/features/cart/cart-cookie";
import { getOwnedActiveCart, getOwnedCartForCheckout } from "@/features/cart/ownership";
import { hashCartToken } from "@/features/cart/cart-session";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

const CART_ID = "22222222-2222-4222-8222-222222222222";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "a".repeat(43);

function fakeClient(row: { id: string; checkout_order_id: string | null } | null) {
  const filters: Array<[string, unknown]> = [];
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((column: string, value: unknown) => {
      filters.push([column, value]);
      return builder;
    }),
    maybeSingle: vi.fn(async () => ({ data: row, error: null })),
  };
  return { client: { from: vi.fn(() => builder) }, filters };
}

describe("cart ownership authorization", () => {
  afterEach(() => vi.resetAllMocks());

  it("authorizes with cart id, tenant and the hash of the HttpOnly secret", async () => {
    vi.mocked(getCartCredentials).mockResolvedValue({ cartId: CART_ID, token: TOKEN });
    const fake = fakeClient({ id: CART_ID, checkout_order_id: null });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(fake.client as never);

    await expect(getOwnedActiveCart("loja-a", TENANT_ID)).resolves.toEqual({
      id: CART_ID,
      ownerTokenHash: hashCartToken(TOKEN),
      checkoutOrderId: null,
    });
    expect(fake.filters).toEqual([
      ["id", CART_ID],
      ["tenant_id", TENANT_ID],
      ["owner_token_hash", hashCartToken(TOKEN)],
    ]);
  });

  it("returns no cart for a missing/invalid cookie without touching the database", async () => {
    vi.mocked(getCartCredentials).mockResolvedValue(null);
    await expect(getOwnedActiveCart("loja-a", TENANT_ID)).resolves.toBeNull();
    expect(createSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });

  it("keeps a checked-out cart available only to the idempotent checkout path", async () => {
    const orderId = "33333333-3333-4333-8333-333333333333";
    vi.mocked(getCartCredentials).mockResolvedValue({ cartId: CART_ID, token: TOKEN });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      fakeClient({ id: CART_ID, checkout_order_id: orderId }).client as never,
    );
    await expect(getOwnedCartForCheckout("loja-a", TENANT_ID)).resolves.toMatchObject({ checkoutOrderId: orderId });

    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      fakeClient({ id: CART_ID, checkout_order_id: orderId }).client as never,
    );
    await expect(getOwnedActiveCart("loja-a", TENANT_ID)).resolves.toBeNull();
  });
});
