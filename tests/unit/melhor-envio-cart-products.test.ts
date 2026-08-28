import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * D3.2-B Ponto 2C — `buildMelhorEnvioProductsFromCart`. A leitura em si
 * (tenant isolation entre cart_items/products, `prevent_cross_tenant_cart_item`)
 * já é coberta exaustivamente por `tests/integration/cart.test.ts`
 * ("rejects a product from a different tenant...", "carts of different
 * tenants operate independently...") — este arquivo mocka o client do
 * Supabase (mesmo padrão de `tests/unit/melhorenvio-callback-route.test.ts`)
 * e foca só na lógica desta função: filtrar produto inativo, detectar
 * dado incompleto, mapear para `ShipmentQuoteProduct` usando o preço
 * efetivo já existente (`effectivePrice`).
 */
vi.mock("@/lib/supabase/server", () => ({ createSupabasePublicClient: vi.fn() }));

import { createSupabasePublicClient } from "@/lib/supabase/server";
import { buildMelhorEnvioProductsFromCart } from "@/features/shipping/melhor-envio-cart-products";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const CART_ID = "22222222-2222-2222-2222-222222222222";

function fakeSupabase(rows: unknown[]) {
  const eq2 = vi.fn().mockResolvedValue({ data: rows, error: null });
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  const from = vi.fn(() => ({ select }));
  return { from, select, eq1, eq2 };
}

function completeProduct(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "product-1",
    price: 100,
    promotional_price: null,
    status: "active",
    weight: 1.25,
    height: 10,
    width: 15,
    length: 20,
    ...overrides,
  };
}

describe("buildMelhorEnvioProductsFromCart", () => {
  afterEach(() => {
    vi.mocked(createSupabasePublicClient).mockReset();
  });

  it("returns unavailable/empty_cart when the cart has no rows", async () => {
    const supabase = fakeSupabase([]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

    const result = await buildMelhorEnvioProductsFromCart(TENANT_ID, CART_ID);
    expect(result).toEqual({ status: "unavailable", reason: "empty_cart" });
  });

  it("returns unavailable/empty_cart when every product in the cart is inactive (never blocks by throwing)", async () => {
    const supabase = fakeSupabase([{ quantity: 1, product: completeProduct({ status: "inactive" }) }]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

    const result = await buildMelhorEnvioProductsFromCart(TENANT_ID, CART_ID);
    expect(result).toEqual({ status: "unavailable", reason: "empty_cart" });
  });

  it.each(["weight", "height", "width", "length"] as const)(
    "returns unavailable/incomplete_product_data when any active product has %s = NULL",
    async (field) => {
      const supabase = fakeSupabase([{ quantity: 2, product: completeProduct({ [field]: null }) }]);
      vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

      const result = await buildMelhorEnvioProductsFromCart(TENANT_ID, CART_ID);
      expect(result).toEqual({ status: "unavailable", reason: "incomplete_product_data" });
    },
  );

  it("one incomplete product blocks the whole cart, even when other products are complete", async () => {
    const supabase = fakeSupabase([
      { quantity: 1, product: completeProduct({ id: "complete" }) },
      { quantity: 1, product: completeProduct({ id: "incomplete", weight: null }) },
    ]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

    const result = await buildMelhorEnvioProductsFromCart(TENANT_ID, CART_ID);
    expect(result).toEqual({ status: "unavailable", reason: "incomplete_product_data" });
  });

  it("maps a complete cart to products[] with id/height/width/length/weight/quantity, and insuranceValue = price when no promotional_price", async () => {
    const supabase = fakeSupabase([{ quantity: 3, product: completeProduct() }]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

    const result = await buildMelhorEnvioProductsFromCart(TENANT_ID, CART_ID);
    expect(result).toEqual({
      status: "ok",
      products: [{ id: "product-1", height: 10, width: 15, length: 20, weight: 1.25, insuranceValue: 100, quantity: 3 }],
    });
  });

  it("uses effectivePrice (promotional_price) as insuranceValue when a promotional price is set — never the normal price", async () => {
    const supabase = fakeSupabase([{ quantity: 1, product: completeProduct({ price: 100, promotional_price: 79.9 }) }]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

    const result = await buildMelhorEnvioProductsFromCart(TENANT_ID, CART_ID);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.products[0]!.insuranceValue).toBe(79.9);
    }
  });

  it("excludes inactive products from products[] without blocking the active ones", async () => {
    const supabase = fakeSupabase([
      { quantity: 1, product: completeProduct({ id: "active", status: "active" }) },
      { quantity: 5, product: completeProduct({ id: "inactive", status: "inactive", weight: null }) },
    ]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

    const result = await buildMelhorEnvioProductsFromCart(TENANT_ID, CART_ID);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.products).toHaveLength(1);
      expect(result.products[0]!.id).toBe("active");
    }
  });

  it("uses cart_items.quantity directly, never multiplying weight by quantity", async () => {
    const supabase = fakeSupabase([{ quantity: 7, product: completeProduct({ weight: 0.5 }) }]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

    const result = await buildMelhorEnvioProductsFromCart(TENANT_ID, CART_ID);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.products[0]!.quantity).toBe(7);
      expect(result.products[0]!.weight).toBe(0.5);
    }
  });

  it("scopes the query by both tenant_id and cart_id explicitly (defense in depth beyond RLS)", async () => {
    const supabase = fakeSupabase([{ quantity: 1, product: completeProduct() }]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

    await buildMelhorEnvioProductsFromCart(TENANT_ID, CART_ID);
    expect(supabase.eq1).toHaveBeenCalledWith("cart_id", CART_ID);
    expect(supabase.eq2).toHaveBeenCalledWith("tenant_id", TENANT_ID);
  });
});
