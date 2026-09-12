import { describe, expect, it } from "vitest";
import { cartSubtotal, effectivePrice, lineSubtotal } from "@/features/cart/pricing";
import { getCartCookieName } from "@/features/cart/cart-cookie-name";

describe("effectivePrice", () => {
  it("uses the regular price when there's no promotional price", () => {
    expect(effectivePrice({ price: 100, promotional_price: null })).toBe(100);
  });

  it("prefers the promotional price when set", () => {
    expect(effectivePrice({ price: 100, promotional_price: 79.9 })).toBe(79.9);
  });
});

describe("effectivePrice — variante (D20.4, também usado pelo storefront desde D20.6 Fase 3.4)", () => {
  it("usa o preço da variante, não o do produto-pai, quando uma variante é informada", () => {
    expect(effectivePrice({ price: 100, promotional_price: null }, { price: 150, promotional_price: null })).toBe(150);
  });

  it("prefere o preço promocional DA VARIANTE, mesmo que o produto-pai não tenha nenhum", () => {
    expect(effectivePrice({ price: 100, promotional_price: null }, { price: 150, promotional_price: 120 })).toBe(120);
  });

  it("variant undefined/null preserva 100% o comportamento de produto simples (preço do produto-pai)", () => {
    expect(effectivePrice({ price: 100, promotional_price: 79.9 })).toBe(79.9);
    expect(effectivePrice({ price: 100, promotional_price: 79.9 }, null)).toBe(79.9);
    expect(effectivePrice({ price: 100, promotional_price: 79.9 }, undefined)).toBe(79.9);
  });
});

describe("lineSubtotal", () => {
  it("multiplies the effective price by quantity", () => {
    expect(lineSubtotal({ price: 10, promotional_price: null }, 3)).toBe(30);
    expect(lineSubtotal({ price: 10, promotional_price: 8 }, 3)).toBe(24);
  });
});

describe("cartSubtotal", () => {
  it("sums line subtotals across items", () => {
    const items = [
      { product: { price: 10, promotional_price: null }, quantity: 2, available: true },
      { product: { price: 5, promotional_price: 4 }, quantity: 3, available: true },
    ];
    expect(cartSubtotal(items)).toBe(10 * 2 + 4 * 3);
  });

  it("excludes unavailable items from the monetary subtotal", () => {
    const items = [
      { product: { price: 10, promotional_price: null }, quantity: 2, available: true },
      { product: { price: 999, promotional_price: null }, quantity: 5, available: false },
    ];
    expect(cartSubtotal(items)).toBe(20);
  });

  it("returns 0 for an empty cart", () => {
    expect(cartSubtotal([])).toBe(0);
  });
});

describe("getCartCookieName", () => {
  it("is scoped per store slug — never a single cookie shared across stores", () => {
    expect(getCartCookieName("loja-a")).toBe("vexo_cart_loja-a");
    expect(getCartCookieName("loja-b")).toBe("vexo_cart_loja-b");
    expect(getCartCookieName("loja-a")).not.toBe(getCartCookieName("loja-b"));
  });
});
