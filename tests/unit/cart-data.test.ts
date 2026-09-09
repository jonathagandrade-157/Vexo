import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * D20.4 (correção MEDIUM-1 da revisão de segurança) — `getCart`. A
 * leitura em si (isolamento de tenant, RLS/trigger de cart_items/
 * product_variants) já é coberta exaustivamente por
 * `tests/integration/cart.test.ts` — este arquivo mocka o client do
 * Supabase e as duas dependências de resolução (`resolveStorefrontTenant`,
 * `getCartId`), mesmo padrão de `tests/unit/melhor-envio-cart-products.test.ts`,
 * e foca só na lógica de mapeamento que o Postgres sozinho não consegue
 * exercitar num teste de integração (a distinção "sem variante" vs.
 * "variante existe mas o embed da RLS retornou null" só é observável do
 * lado do código TypeScript que consome o resultado do PostgREST).
 */
vi.mock("@/lib/supabase/server", () => ({ createSupabasePublicClient: vi.fn() }));
vi.mock("@/features/storefront/resolve-tenant", () => ({ resolveStorefrontTenant: vi.fn() }));
vi.mock("@/features/cart/cart-cookie", () => ({ getCartId: vi.fn() }));

import { createSupabasePublicClient } from "@/lib/supabase/server";
import { resolveStorefrontTenant } from "@/features/storefront/resolve-tenant";
import { getCartId } from "@/features/cart/cart-cookie";
import { getCart } from "@/features/cart/data";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const CART_ID = "22222222-2222-2222-2222-222222222222";
const STORE_SLUG = "loja-teste";

function fakeSupabase(rows: unknown[]) {
  const order = vi.fn().mockResolvedValue({ data: rows, error: null });
  const eq2 = vi.fn(() => ({ order }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  const from = vi.fn(() => ({ select }));
  return { from, select, eq1, eq2, order };
}

function product(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "product-1",
    name: "Camiseta",
    slug: "camiseta",
    price: 50,
    promotional_price: null,
    main_image: null,
    status: "active",
    ...overrides,
  };
}

function activeVariant(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "variant-1",
    sku: "CAM-PRT-M",
    price: 60,
    promotional_price: null,
    is_active: true,
    ...overrides,
  };
}

describe("getCart", () => {
  afterEach(() => {
    vi.mocked(createSupabasePublicClient).mockReset();
    vi.mocked(resolveStorefrontTenant).mockReset();
    vi.mocked(getCartId).mockReset();
  });

  function setup(rows: unknown[]) {
    vi.mocked(resolveStorefrontTenant).mockResolvedValue({ status: "ready", tenant: { id: TENANT_ID } } as never);
    vi.mocked(getCartId).mockResolvedValue(CART_ID);
    const supabase = fakeSupabase(rows);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);
    return supabase;
  }

  // 1 — produto simples continua disponível normalmente.
  it("a simple product (variant_id null) remains available, with variant null and variantId null", async () => {
    setup([{ id: "item-1", quantity: 2, variant_id: null, product: product(), variant: null }]);

    const cart = await getCart(STORE_SLUG);

    expect(cart.items).toEqual([
      {
        id: "item-1",
        quantity: 2,
        available: true,
        product: { id: "product-1", name: "Camiseta", slug: "camiseta", price: 50, promotional_price: null, main_image: null },
        variantId: null,
        variant: null,
      },
    ]);
    expect(cart.subtotal).toBe(100); // preço do produto, comportamento de Etapa 9 intacto
  });

  // 7 — produto simples inativo: comportamento já existente (fora do escopo desta correção), reconfirmado sem regressão.
  it("a simple, now-inactive product: no regression from this fix (documented pre-existing behavior)", async () => {
    // `product: null` simula fielmente o que a RLS pública de `products`
    // (exige status='active') faz ao embed quando o produto está
    // inativo — o mesmo mecanismo do MEDIUM-1, só que do lado do
    // produto, já existente desde Etapa 9 e fora do escopo desta
    // correção (que só toca o ramo de variante).
    setup([{ id: "item-1", quantity: 1, variant_id: null, product: null, variant: null }]);

    const cart = await getCart(STORE_SLUG);

    expect(cart.items).toEqual([]);
  });

  // 2/5 — variante ativa continua disponível, e o preço da variante prevalece sobre o do produto-pai.
  it("an active variant remains available, uses the VARIANT price (never the parent product's), and is identifiable by variantId", async () => {
    setup([
      {
        id: "item-1",
        quantity: 3,
        variant_id: "variant-1",
        product: product({ price: 50 }),
        variant: activeVariant({ price: 60 }),
      },
    ]);

    const cart = await getCart(STORE_SLUG);

    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({
      available: true,
      variantId: "variant-1",
      variant: { id: "variant-1", sku: "CAM-PRT-M", price: 60, promotional_price: null },
    });
    // 3 * 60 (preço da VARIANTE), nunca 3 * 50 (preço do produto-pai).
    expect(cart.subtotal).toBe(180);
  });

  // 3/4/5/6 — variante existente no cart_item, mas o embed voltou null
  // (RLS ocultou por is_active=false) — o item NÃO pode cair no
  // fallback de produto simples: fica indisponível, sem usar o preço do
  // produto-pai, mas continua identificável pelo variantId.
  it("MEDIUM-1 fix: a variant_id present with a null embed (deactivated variant) is marked unavailable, never falls back to the parent product's price, and stays identifiable via variantId", async () => {
    setup([
      {
        id: "item-1",
        quantity: 2,
        variant_id: "variant-1", // continua preenchido na própria linha de cart_items
        product: product({ price: 50 }),
        variant: null, // embed da RLS ocultou a variante inativa
      },
    ]);

    const cart = await getCart(STORE_SLUG);

    expect(cart.items).toHaveLength(1);
    const item = cart.items[0]!;
    expect(item.available).toBe(false); // nunca disponível quando a variante não pôde ser confirmada
    expect(item.variant).toBeNull(); // nunca preenchido com dado do produto-pai
    expect(item.variantId).toBe("variant-1"); // mas continua identificável como item de variante
    expect(cart.subtotal).toBe(0); // item excluído do subtotal — preço do produto-pai NUNCA usado silenciosamente
  });

  // Confirma explicitamente que o item indisponível não é confundido com produto simples mesmo com múltiplos itens no carrinho.
  it("a mix of simple product, active variant, and deactivated variant computes availability/subtotal correctly for each", async () => {
    setup([
      { id: "simple", quantity: 1, variant_id: null, product: product({ id: "p-simple", price: 20 }), variant: null },
      {
        id: "active-variant",
        quantity: 1,
        variant_id: "variant-1",
        product: product({ id: "p-variant", price: 50 }),
        variant: activeVariant({ price: 60 }),
      },
      {
        id: "inactive-variant",
        quantity: 5,
        variant_id: "variant-2",
        product: product({ id: "p-variant", price: 50 }),
        variant: null,
      },
    ]);

    const cart = await getCart(STORE_SLUG);

    expect(cart.items.map((i) => ({ id: i.id, available: i.available, variantId: i.variantId }))).toEqual([
      { id: "simple", available: true, variantId: null },
      { id: "active-variant", available: true, variantId: "variant-1" },
      { id: "inactive-variant", available: false, variantId: "variant-2" },
    ]);
    // itemCount soma TODOS (mesmo indisponíveis): 1 + 1 + 5 = 7.
    expect(cart.itemCount).toBe(7);
    // subtotal só simples (20*1) + variante ativa (60*1) — a variante desativada nunca entra, nem pelo preço do produto-pai.
    expect(cart.subtotal).toBe(80);
  });
});
