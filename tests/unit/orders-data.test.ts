import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * D20.5 — `getOrderDetail` (features/orders/data.ts). A leitura em si
 * (RLS/isolamento de tenant, máquina de estados) já é coberta
 * exaustivamente por tests/integration/order-management.test.ts e
 * tests/integration/checkout-variants.test.ts — este arquivo mocka o
 * client do Supabase (mesmo padrão de tests/unit/history-data.test.ts) e
 * foca só na passagem das novas colunas de snapshot de variante
 * (variant_id/variant_sku/variant_label/variant_options) para
 * OrderDetailItem: presentes e corretas para item de variante, sempre
 * null para produto simples.
 */
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrderDetail } from "@/features/orders/data";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const ORDER_ID = "22222222-2222-2222-2222-222222222222";

function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: typeof result) => void, reject?: (e: unknown) => void) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

const baseOrder = {
  id: ORDER_ID,
  order_number: "PED000001",
  status: "PENDING",
  payment_status: "PENDING",
  order_source: "vexo_checkout",
  payment_channel: "gateway",
  requested_payment_method: null,
  cash_change_for: null,
  customer_name: "Cliente Teste",
  customer_email: "cliente@example.com",
  customer_phone: "11999999999",
  shipping_address: null,
  subtotal: 100,
  discount_total: 0,
  shipping_total: 0,
  total: 100,
  shipping_method: null,
  shipping_provider: null,
  shipping_estimated_days: null,
  internal_note: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function mockSupabase(options: { order?: unknown; items?: unknown[]; history?: unknown[] } = {}) {
  const orderData = "order" in options ? options.order : baseOrder;
  const from = vi.fn((table: string) => {
    if (table === "orders") return makeChain({ data: orderData, error: null });
    if (table === "order_items") return makeChain({ data: options.items ?? [], error: null });
    if (table === "audit_logs") return makeChain({ data: options.history ?? [], error: null });
    throw new Error(`unexpected table in test mock: ${table}`);
  });
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);
  return { from };
}

describe("getOrderDetail (D20.5 — snapshot de variante)", () => {
  afterEach(() => {
    vi.mocked(createSupabaseServerClient).mockReset();
  });

  it("item de produto simples: variant_id/variant_sku/variant_label/variant_options todos null", async () => {
    mockSupabase({
      items: [
        {
          id: "item-1",
          product_name: "Camiseta",
          product_slug: "camiseta",
          quantity: 2,
          unit_price: 50,
          subtotal: 100,
          variant_id: null,
          variant_sku: null,
          variant_label: null,
          variant_options: null,
        },
      ],
    });

    const detail = await getOrderDetail(TENANT_ID, ORDER_ID);

    expect(detail?.items[0]).toMatchObject({
      variant_id: null,
      variant_sku: null,
      variant_label: null,
      variant_options: null,
    });
  });

  it("item de variante: variant_id/variant_sku/variant_label/variant_options passam intactos, na forma de array estruturado", async () => {
    mockSupabase({
      items: [
        {
          id: "item-1",
          product_name: "Camiseta",
          product_slug: "camiseta",
          quantity: 1,
          unit_price: 80,
          subtotal: 80,
          variant_id: "33333333-3333-3333-3333-333333333333",
          variant_sku: "CAM-PRT-M",
          variant_label: "Preto / M",
          variant_options: [
            { option: "Cor", value: "Preto" },
            { option: "Tamanho", value: "M" },
          ],
        },
      ],
    });

    const detail = await getOrderDetail(TENANT_ID, ORDER_ID);

    expect(detail?.items[0]).toMatchObject({
      variant_id: "33333333-3333-3333-3333-333333333333",
      variant_sku: "CAM-PRT-M",
      variant_label: "Preto / M",
      variant_options: [
        { option: "Cor", value: "Preto" },
        { option: "Tamanho", value: "M" },
      ],
    });
  });

  it("variante excluída depois da compra: variant_id volta a null, mas variant_sku/variant_label/variant_options continuam preenchidos (snapshot nunca desaparece)", async () => {
    mockSupabase({
      items: [
        {
          id: "item-1",
          product_name: "Camiseta",
          product_slug: "camiseta",
          quantity: 1,
          unit_price: 80,
          subtotal: 80,
          variant_id: null,
          variant_sku: "CAM-PRT-M",
          variant_label: "Preto / M",
          variant_options: [{ option: "Cor", value: "Preto" }],
        },
      ],
    });

    const detail = await getOrderDetail(TENANT_ID, ORDER_ID);

    expect(detail?.items[0]?.variant_id).toBeNull();
    expect(detail?.items[0]?.variant_sku).toBe("CAM-PRT-M");
    expect(detail?.items[0]?.variant_label).toBe("Preto / M");
  });

  it("pedido inexistente/de outro tenant: retorna null e nunca consulta order_items/audit_logs", async () => {
    const { from } = mockSupabase({ order: null });

    const detail = await getOrderDetail(TENANT_ID, ORDER_ID);

    expect(detail).toBeNull();
    expect(from).not.toHaveBeenCalledWith("order_items");
    expect(from).not.toHaveBeenCalledWith("audit_logs");
  });

  it("select() de order_items inclui explicitamente as 4 colunas novas de variante", async () => {
    const selectSpy = vi.fn();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      from: (table: string) => {
        if (table === "orders") return makeChain({ data: baseOrder, error: null });
        if (table === "order_items") {
          const chain = makeChain({ data: [], error: null });
          const originalSelect = chain.select as () => typeof chain;
          chain.select = (...args: unknown[]) => {
            selectSpy(...args);
            return originalSelect();
          };
          return chain;
        }
        if (table === "audit_logs") return makeChain({ data: [], error: null });
        throw new Error(`unexpected table: ${table}`);
      },
    } as never);

    await getOrderDetail(TENANT_ID, ORDER_ID);

    expect(selectSpy).toHaveBeenCalledWith(expect.stringContaining("variant_id"));
    const [columns] = selectSpy.mock.calls[0]!;
    expect(columns as string).toContain("variant_sku");
    expect(columns as string).toContain("variant_label");
    expect(columns as string).toContain("variant_options");
  });
});
