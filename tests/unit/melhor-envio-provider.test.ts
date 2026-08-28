import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * D3.2-B Ponto 2D — `createMelhorEnvioProvider()` (`lib/shipping/melhor-envio.ts`).
 * Todas as três dependências são mockadas (cada uma já testada
 * isoladamente: `calculateShipmentQuote` em
 * `tests/unit/melhorenvio-quote.test.ts`, `buildMelhorEnvioProductsFromCart`
 * em `tests/unit/melhor-envio-cart-products.test.ts`, leitura de
 * `shipping_settings` via o mesmo client mockado de sempre) — o foco
 * aqui é só a ORQUESTRAÇÃO deste arquivo: resolver origin_zip, decidir
 * quando chamar a API, e mapear a resposta para `ShippingQuoteOption`.
 */
vi.mock("@/lib/shipping-connections/melhorenvio-quote", () => ({ calculateShipmentQuote: vi.fn() }));
vi.mock("@/features/shipping/melhor-envio-cart-products", () => ({ buildMelhorEnvioProductsFromCart: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabasePublicClient: vi.fn() }));

import { calculateShipmentQuote } from "@/lib/shipping-connections/melhorenvio-quote";
import { buildMelhorEnvioProductsFromCart } from "@/features/shipping/melhor-envio-cart-products";
import { createSupabasePublicClient } from "@/lib/supabase/server";
import { createMelhorEnvioProvider } from "@/lib/shipping/melhor-envio";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const CART_ID = "22222222-2222-2222-2222-222222222222";
const DESTINATION_ZIP = "11111111";

const SAMPLE_PRODUCTS = [{ id: "p1", height: 10, width: 15, length: 20, weight: 1.25, insuranceValue: 100, quantity: 1 }];

function fakeShippingSettings(row: { enabled: boolean; origin_zip: string | null } | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from, select, eq, maybeSingle };
}

describe("createMelhorEnvioProvider", () => {
  afterEach(() => {
    vi.mocked(calculateShipmentQuote).mockReset();
    vi.mocked(buildMelhorEnvioProductsFromCart).mockReset();
    vi.mocked(createSupabasePublicClient).mockReset();
  });

  it("1. maps a successful quote to ShippingQuoteOption[] — id=serviceId, type=melhor_envio, estimatedDays=deliveryTime", async () => {
    vi.mocked(createSupabasePublicClient).mockReturnValue(fakeShippingSettings({ enabled: true, origin_zip: "00000000" }) as never);
    vi.mocked(buildMelhorEnvioProductsFromCart).mockResolvedValue({ status: "ok", products: SAMPLE_PRODUCTS });
    vi.mocked(calculateShipmentQuote).mockResolvedValue({
      status: "ok",
      options: [{ provider: "melhor_envio", serviceId: "1", name: "PAC", price: 27.48, deliveryTime: 10, currency: "BRL" }],
    });

    const provider = createMelhorEnvioProvider();
    const result = await provider.getQuote(TENANT_ID, DESTINATION_ZIP, CART_ID);

    expect(result).toEqual({
      status: "ok",
      options: [{ id: "1", name: "PAC", price: 27.48, estimatedDays: 10, type: "melhor_envio" }],
    });
  });

  it("9. maps multiple valid services returned by the API", async () => {
    vi.mocked(createSupabasePublicClient).mockReturnValue(fakeShippingSettings({ enabled: true, origin_zip: "00000000" }) as never);
    vi.mocked(buildMelhorEnvioProductsFromCart).mockResolvedValue({ status: "ok", products: SAMPLE_PRODUCTS });
    vi.mocked(calculateShipmentQuote).mockResolvedValue({
      status: "ok",
      options: [
        { provider: "melhor_envio", serviceId: "1", name: "PAC", price: 27.48, deliveryTime: 10, currency: "BRL" },
        { provider: "melhor_envio", serviceId: "2", name: "SEDEX", price: 45.9, deliveryTime: 3, currency: "BRL" },
      ],
    });

    const provider = createMelhorEnvioProvider();
    const result = await provider.getQuote(TENANT_ID, DESTINATION_ZIP, CART_ID);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.options).toHaveLength(2);
      expect(result.options.map((o) => o.id)).toEqual(["1", "2"]);
    }
  });

  it("2. never connected (calculateShipmentQuote reports unavailable) → unavailable, propagated without inventing details", async () => {
    vi.mocked(createSupabasePublicClient).mockReturnValue(fakeShippingSettings({ enabled: true, origin_zip: "00000000" }) as never);
    vi.mocked(buildMelhorEnvioProductsFromCart).mockResolvedValue({ status: "ok", products: SAMPLE_PRODUCTS });
    vi.mocked(calculateShipmentQuote).mockResolvedValue({ status: "unavailable", reason: "not_connected" });

    const provider = createMelhorEnvioProvider();
    const result = await provider.getQuote(TENANT_ID, DESTINATION_ZIP, CART_ID);
    expect(result).toEqual({ status: "unavailable" });
  });

  it("11. API upstream failure (timeout/5xx already classified downstream) → unavailable, never throws", async () => {
    vi.mocked(createSupabasePublicClient).mockReturnValue(fakeShippingSettings({ enabled: true, origin_zip: "00000000" }) as never);
    vi.mocked(buildMelhorEnvioProductsFromCart).mockResolvedValue({ status: "ok", products: SAMPLE_PRODUCTS });
    vi.mocked(calculateShipmentQuote).mockResolvedValue({ status: "unavailable", reason: "temporarily_unavailable" });

    const provider = createMelhorEnvioProvider();
    const result = await provider.getQuote(TENANT_ID, DESTINATION_ZIP, CART_ID);
    expect(result).toEqual({ status: "unavailable" });
  });

  it("no cart yet (cartId null) → unavailable without reading shipping_settings or building products", async () => {
    const provider = createMelhorEnvioProvider();
    const result = await provider.getQuote(TENANT_ID, DESTINATION_ZIP, null);

    expect(result).toEqual({ status: "unavailable" });
    expect(createSupabasePublicClient).not.toHaveBeenCalled();
    expect(buildMelhorEnvioProductsFromCart).not.toHaveBeenCalled();
    expect(calculateShipmentQuote).not.toHaveBeenCalled();
  });

  it("7. origin_zip missing (no shipping_settings row) → unavailable, never calls buildMelhorEnvioProductsFromCart/calculateShipmentQuote", async () => {
    vi.mocked(createSupabasePublicClient).mockReturnValue(fakeShippingSettings(null) as never);

    const provider = createMelhorEnvioProvider();
    const result = await provider.getQuote(TENANT_ID, DESTINATION_ZIP, CART_ID);

    expect(result).toEqual({ status: "unavailable" });
    expect(buildMelhorEnvioProductsFromCart).not.toHaveBeenCalled();
    expect(calculateShipmentQuote).not.toHaveBeenCalled();
  });

  it("7b. shipping disabled (shipping_settings.enabled=false) → unavailable, same as origin_zip missing", async () => {
    vi.mocked(createSupabasePublicClient).mockReturnValue(fakeShippingSettings({ enabled: false, origin_zip: "00000000" }) as never);

    const provider = createMelhorEnvioProvider();
    const result = await provider.getQuote(TENANT_ID, DESTINATION_ZIP, CART_ID);

    expect(result).toEqual({ status: "unavailable" });
    expect(buildMelhorEnvioProductsFromCart).not.toHaveBeenCalled();
    expect(calculateShipmentQuote).not.toHaveBeenCalled();
  });

  it("8. origin_zip null (shipping enabled but no origin configured) → unavailable, never calls the API", async () => {
    vi.mocked(createSupabasePublicClient).mockReturnValue(fakeShippingSettings({ enabled: true, origin_zip: null }) as never);

    const provider = createMelhorEnvioProvider();
    const result = await provider.getQuote(TENANT_ID, DESTINATION_ZIP, CART_ID);

    expect(result).toEqual({ status: "unavailable" });
    expect(buildMelhorEnvioProductsFromCart).not.toHaveBeenCalled();
    expect(calculateShipmentQuote).not.toHaveBeenCalled();
  });

  it("3-6. incomplete product data (buildMelhorEnvioProductsFromCart reports unavailable) → unavailable, never calls calculateShipmentQuote", async () => {
    vi.mocked(createSupabasePublicClient).mockReturnValue(fakeShippingSettings({ enabled: true, origin_zip: "00000000" }) as never);
    vi.mocked(buildMelhorEnvioProductsFromCart).mockResolvedValue({ status: "unavailable", reason: "incomplete_product_data" });

    const provider = createMelhorEnvioProvider();
    const result = await provider.getQuote(TENANT_ID, DESTINATION_ZIP, CART_ID);

    expect(result).toEqual({ status: "unavailable" });
    expect(calculateShipmentQuote).not.toHaveBeenCalled();
  });

  it("12/13. originZip and products are always resolved server-side — getQuote's public signature has no way to inject either", async () => {
    vi.mocked(createSupabasePublicClient).mockReturnValue(fakeShippingSettings({ enabled: true, origin_zip: "00000000" }) as never);
    vi.mocked(buildMelhorEnvioProductsFromCart).mockResolvedValue({ status: "ok", products: SAMPLE_PRODUCTS });
    vi.mocked(calculateShipmentQuote).mockResolvedValue({ status: "ok", options: [] });

    const provider = createMelhorEnvioProvider();
    // A assinatura pública (tenantId, destinationZip, cartId) não aceita
    // originZip/products/insurance_value do chamador — só é possível
    // confirmar isso conferindo com QUAIS argumentos exatos
    // calculateShipmentQuote foi chamado: sempre os valores resolvidos
    // internamente (mockados acima), nunca algo vindo de fora.
    await provider.getQuote(TENANT_ID, DESTINATION_ZIP, CART_ID);

    expect(calculateShipmentQuote).toHaveBeenCalledWith(
      expect.objectContaining({ originZip: "00000000", destinationZip: DESTINATION_ZIP, products: SAMPLE_PRODUCTS }),
    );
  });

  it("14. tenant isolation — the exact same tenantId flows into shipping_settings, buildMelhorEnvioProductsFromCart and calculateShipmentQuote", async () => {
    const settings = fakeShippingSettings({ enabled: true, origin_zip: "00000000" });
    vi.mocked(createSupabasePublicClient).mockReturnValue(settings as never);
    vi.mocked(buildMelhorEnvioProductsFromCart).mockResolvedValue({ status: "ok", products: SAMPLE_PRODUCTS });
    vi.mocked(calculateShipmentQuote).mockResolvedValue({ status: "ok", options: [] });

    const provider = createMelhorEnvioProvider();
    await provider.getQuote(TENANT_ID, DESTINATION_ZIP, CART_ID);

    expect(settings.eq).toHaveBeenCalledWith("tenant_id", TENANT_ID);
    expect(buildMelhorEnvioProductsFromCart).toHaveBeenCalledWith(TENANT_ID, CART_ID);
    expect(calculateShipmentQuote).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT_ID }));
  });

  it("services is always the fixed internal default — never empty, never invented per-call", async () => {
    vi.mocked(createSupabasePublicClient).mockReturnValue(fakeShippingSettings({ enabled: true, origin_zip: "00000000" }) as never);
    vi.mocked(buildMelhorEnvioProductsFromCart).mockResolvedValue({ status: "ok", products: SAMPLE_PRODUCTS });
    vi.mocked(calculateShipmentQuote).mockResolvedValue({ status: "ok", options: [] });

    const provider = createMelhorEnvioProvider();
    await provider.getQuote(TENANT_ID, DESTINATION_ZIP, CART_ID);

    const call = vi.mocked(calculateShipmentQuote).mock.calls[0]![0];
    expect(call.services).toEqual([1, 2]);
  });
});
