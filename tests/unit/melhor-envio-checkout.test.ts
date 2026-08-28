import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * D3.2-B Ponto 2E — `verifyMelhorEnvioShippingFresh`/`applyMelhorEnvioShippingToOrder`
 * (`features/shipping/melhor-envio-checkout.ts`). Este é o ponto crítico
 * de segurança da integração: preço/serviceId/prazo do navegador nunca
 * são autoridade — sempre revalidados contra uma cotação NOVA
 * (`calculateShipmentQuote`, mockado; já testado isoladamente em
 * `tests/unit/melhorenvio-quote.test.ts`).
 */
vi.mock("@/lib/shipping-connections/melhorenvio-quote", () => ({ calculateShipmentQuote: vi.fn() }));
vi.mock("@/features/shipping/melhor-envio-cart-products", () => ({ buildMelhorEnvioProductsFromCart: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabasePublicClient: vi.fn(),
  createSupabaseServiceRoleClient: vi.fn(),
}));

import { calculateShipmentQuote } from "@/lib/shipping-connections/melhorenvio-quote";
import { buildMelhorEnvioProductsFromCart } from "@/features/shipping/melhor-envio-cart-products";
import { createSupabasePublicClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { applyMelhorEnvioShippingToOrder, verifyMelhorEnvioShippingFresh } from "@/features/shipping/melhor-envio-checkout";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT_ID = "99999999-9999-9999-9999-999999999999";
const CART_ID = "22222222-2222-2222-2222-222222222222";
const DESTINATION_ZIP = "11111111";
const ORDER_ID = "33333333-3333-3333-3333-333333333333";

const SAMPLE_PRODUCTS = [{ id: "p1", height: 10, width: 15, length: 20, weight: 1.25, insuranceValue: 100, quantity: 1 }];

function fakeShippingSettings(row: { enabled: boolean; origin_zip: string | null } | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from, select, eq, maybeSingle };
}

function fakeConnected() {
  vi.mocked(createSupabasePublicClient).mockReturnValue(fakeShippingSettings({ enabled: true, origin_zip: "00000000" }) as never);
  vi.mocked(buildMelhorEnvioProductsFromCart).mockResolvedValue({ status: "ok", products: SAMPLE_PRODUCTS });
}

describe("verifyMelhorEnvioShippingFresh (D3.2-B Ponto 2E)", () => {
  afterEach(() => {
    vi.mocked(calculateShipmentQuote).mockReset();
    vi.mocked(buildMelhorEnvioProductsFromCart).mockReset();
    vi.mocked(createSupabasePublicClient).mockReset();
  });

  it("1/2. Melhor Envio escolhido, preço correto → nova cotação é feita e o resultado é válido, com os valores da API (nunca os do cliente)", async () => {
    fakeConnected();
    vi.mocked(calculateShipmentQuote).mockResolvedValue({
      status: "ok",
      options: [{ provider: "melhor_envio", serviceId: "1", name: "PAC", price: 27.48, deliveryTime: 10, currency: "BRL" }],
    });

    const result = await verifyMelhorEnvioShippingFresh(TENANT_ID, CART_ID, DESTINATION_ZIP, "1", 27.48);

    expect(calculateShipmentQuote).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ valid: true, serviceId: "1", name: "PAC", price: 27.48, estimatedDays: 10 });
  });

  it("SEGURANÇA A. cliente informa shippingPrice=1.00, API real=27.48 → rejeitado (price_changed) — o preço aplicado nunca seria 1.00", async () => {
    fakeConnected();
    vi.mocked(calculateShipmentQuote).mockResolvedValue({
      status: "ok",
      options: [{ provider: "melhor_envio", serviceId: "1", name: "PAC", price: 27.48, deliveryTime: 10, currency: "BRL" }],
    });

    const result = await verifyMelhorEnvioShippingFresh(TENANT_ID, CART_ID, DESTINATION_ZIP, "1", 1.0);
    expect(result).toEqual({ valid: false, reason: "price_changed" });
  });

  it("SEGURANÇA B. serviceId '1' existe a 27.48, cliente informa shippingPrice=0.01 → rejeitado, nunca aplicado com 0.01", async () => {
    fakeConnected();
    vi.mocked(calculateShipmentQuote).mockResolvedValue({
      status: "ok",
      options: [{ provider: "melhor_envio", serviceId: "1", name: "PAC", price: 27.48, deliveryTime: 10, currency: "BRL" }],
    });

    const result = await verifyMelhorEnvioShippingFresh(TENANT_ID, CART_ID, DESTINATION_ZIP, "1", 0.01);
    expect(result).toEqual({ valid: false, reason: "price_changed" });
  });

  it("4/17. serviceId escolhido não existe na nova cotação → rejeitado (service_unavailable)", async () => {
    fakeConnected();
    vi.mocked(calculateShipmentQuote).mockResolvedValue({
      status: "ok",
      options: [{ provider: "melhor_envio", serviceId: "1", name: "PAC", price: 27.48, deliveryTime: 10, currency: "BRL" }],
    });

    const result = await verifyMelhorEnvioShippingFresh(TENANT_ID, CART_ID, DESTINATION_ZIP, "999", 27.48);
    expect(result).toEqual({ valid: false, reason: "service_unavailable" });
  });

  it("5. serviceId válido mas diferente do original — se está na nova cotação com o preço que o cliente esperava, é aceito", async () => {
    fakeConnected();
    vi.mocked(calculateShipmentQuote).mockResolvedValue({
      status: "ok",
      options: [
        { provider: "melhor_envio", serviceId: "1", name: "PAC", price: 27.48, deliveryTime: 10, currency: "BRL" },
        { provider: "melhor_envio", serviceId: "2", name: "SEDEX", price: 45.9, deliveryTime: 3, currency: "BRL" },
      ],
    });

    const result = await verifyMelhorEnvioShippingFresh(TENANT_ID, CART_ID, DESTINATION_ZIP, "2", 45.9);
    expect(result).toEqual({ valid: true, serviceId: "2", name: "SEDEX", price: 45.9, estimatedDays: 3 });
  });

  it("6/7. peso/dimensões nunca vêm do cliente — a função nem aceita esses parâmetros; products sempre vem de buildMelhorEnvioProductsFromCart", async () => {
    fakeConnected();
    vi.mocked(calculateShipmentQuote).mockResolvedValue({ status: "ok", options: [] });

    await verifyMelhorEnvioShippingFresh(TENANT_ID, CART_ID, DESTINATION_ZIP, "1", 27.48);

    expect(calculateShipmentQuote).toHaveBeenCalledWith(expect.objectContaining({ products: SAMPLE_PRODUCTS }));
  });

  it("8. origin_zip nunca vem do cliente — resolvido internamente de shipping_settings, função não aceita esse parâmetro", async () => {
    const settings = fakeShippingSettings({ enabled: true, origin_zip: "00000000" });
    vi.mocked(createSupabasePublicClient).mockReturnValue(settings as never);
    vi.mocked(buildMelhorEnvioProductsFromCart).mockResolvedValue({ status: "ok", products: SAMPLE_PRODUCTS });
    vi.mocked(calculateShipmentQuote).mockResolvedValue({ status: "ok", options: [] });

    await verifyMelhorEnvioShippingFresh(TENANT_ID, CART_ID, DESTINATION_ZIP, "1", 27.48);

    expect(calculateShipmentQuote).toHaveBeenCalledWith(expect.objectContaining({ originZip: "00000000" }));
  });

  it("origin_zip ausente/inválido → rejeitado, sem chamar buildMelhorEnvioProductsFromCart/calculateShipmentQuote", async () => {
    vi.mocked(createSupabasePublicClient).mockReturnValue(fakeShippingSettings({ enabled: true, origin_zip: null }) as never);

    const result = await verifyMelhorEnvioShippingFresh(TENANT_ID, CART_ID, DESTINATION_ZIP, "1", 27.48);
    expect(result).toEqual({ valid: false, reason: "origin_not_configured" });
    expect(buildMelhorEnvioProductsFromCart).not.toHaveBeenCalled();
    expect(calculateShipmentQuote).not.toHaveBeenCalled();
  });

  it("9. tenant_id flui identicamente para shipping_settings, buildMelhorEnvioProductsFromCart e calculateShipmentQuote — nunca trocado no meio do caminho", async () => {
    const settings = fakeShippingSettings({ enabled: true, origin_zip: "00000000" });
    vi.mocked(createSupabasePublicClient).mockReturnValue(settings as never);
    vi.mocked(buildMelhorEnvioProductsFromCart).mockResolvedValue({ status: "ok", products: SAMPLE_PRODUCTS });
    vi.mocked(calculateShipmentQuote).mockResolvedValue({ status: "ok", options: [] });

    await verifyMelhorEnvioShippingFresh(TENANT_ID, CART_ID, DESTINATION_ZIP, "1", 27.48);

    expect(settings.eq).toHaveBeenCalledWith("tenant_id", TENANT_ID);
    expect(buildMelhorEnvioProductsFromCart).toHaveBeenCalledWith(TENANT_ID, CART_ID);
    expect(calculateShipmentQuote).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT_ID }));
    // Nunca o outro tenant, mesmo que existisse em algum lugar do teste.
    expect(buildMelhorEnvioProductsFromCart).not.toHaveBeenCalledWith(OTHER_TENANT_ID, expect.anything());
  });

  it("10. cartId de outro tenant (buildMelhorEnvioProductsFromCart reporta empty_cart) → rejeitado, nunca chama a API", async () => {
    vi.mocked(createSupabasePublicClient).mockReturnValue(fakeShippingSettings({ enabled: true, origin_zip: "00000000" }) as never);
    vi.mocked(buildMelhorEnvioProductsFromCart).mockResolvedValue({ status: "unavailable", reason: "empty_cart" });

    const result = await verifyMelhorEnvioShippingFresh(TENANT_ID, CART_ID, DESTINATION_ZIP, "1", 27.48);
    expect(result).toEqual({ valid: false, reason: "empty_cart" });
    expect(calculateShipmentQuote).not.toHaveBeenCalled();
  });

  it("11. token nunca é parâmetro — a assinatura não tem como o chamador injetar um accessToken", async () => {
    fakeConnected();
    vi.mocked(calculateShipmentQuote).mockResolvedValue({ status: "ok", options: [] });
    // verifyMelhorEnvioShippingFresh(tenantId, cartId, destinationZip, chosenServiceId, expectedPrice)
    // — 5 parâmetros, nenhum deles um token. Confirmado estruturalmente
    // chamando com a assinatura documentada e conferindo que
    // calculateShipmentQuote (o único ponto que de fato usa um token,
    // internamente) nunca recebe nada parecido com token nos argumentos.
    await verifyMelhorEnvioShippingFresh(TENANT_ID, CART_ID, DESTINATION_ZIP, "1", 27.48);
    const call = vi.mocked(calculateShipmentQuote).mock.calls[0]![0];
    expect(Object.keys(call)).not.toContain("accessToken");
    expect(Object.keys(call)).not.toContain("token");
  });

  it("12. Melhor Envio desconectado (calculateShipmentQuote → not_connected) → escolha rejeitada", async () => {
    fakeConnected();
    vi.mocked(calculateShipmentQuote).mockResolvedValue({ status: "unavailable", reason: "not_connected" });

    const result = await verifyMelhorEnvioShippingFresh(TENANT_ID, CART_ID, DESTINATION_ZIP, "1", 27.48);
    expect(result).toEqual({ valid: false, reason: "not_connected" });
  });

  it("14. refresh inválido (needs_reconnection) → reconexão necessária, escolha rejeitada", async () => {
    fakeConnected();
    vi.mocked(calculateShipmentQuote).mockResolvedValue({ status: "unavailable", reason: "needs_reconnection" });

    const result = await verifyMelhorEnvioShippingFresh(TENANT_ID, CART_ID, DESTINATION_ZIP, "1", 27.48);
    expect(result).toEqual({ valid: false, reason: "needs_reconnection" });
  });

  it("15/16. timeout/erro 5xx (temporarily_unavailable) → pedido não deve usar preço antigo, escolha rejeitada", async () => {
    fakeConnected();
    vi.mocked(calculateShipmentQuote).mockResolvedValue({ status: "unavailable", reason: "temporarily_unavailable" });

    const result = await verifyMelhorEnvioShippingFresh(TENANT_ID, CART_ID, DESTINATION_ZIP, "1", 27.48);
    expect(result).toEqual({ valid: false, reason: "temporarily_unavailable" });
  });

  it("nunca usa cache — cada chamada dispara uma nova cotação (calculateShipmentQuote chamado de novo mesmo com os mesmos parâmetros)", async () => {
    fakeConnected();
    vi.mocked(calculateShipmentQuote).mockResolvedValue({
      status: "ok",
      options: [{ provider: "melhor_envio", serviceId: "1", name: "PAC", price: 27.48, deliveryTime: 10, currency: "BRL" }],
    });

    await verifyMelhorEnvioShippingFresh(TENANT_ID, CART_ID, DESTINATION_ZIP, "1", 27.48);
    await verifyMelhorEnvioShippingFresh(TENANT_ID, CART_ID, DESTINATION_ZIP, "1", 27.48);

    expect(calculateShipmentQuote).toHaveBeenCalledTimes(2);
  });
});

describe("applyMelhorEnvioShippingToOrder (D3.2-B Ponto 2E)", () => {
  afterEach(() => {
    vi.mocked(createSupabaseServiceRoleClient).mockReset();
  });

  it("calls the service_role-only RPC with exactly the already-verified values, never re-deriving anything", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue({ rpc } as never);

    const result = await applyMelhorEnvioShippingToOrder(TENANT_ID, ORDER_ID, { serviceId: "1", name: "PAC", price: 27.48, estimatedDays: 10 });

    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("apply_melhor_envio_shipping_to_order", {
      p_tenant_id: TENANT_ID,
      p_order_id: ORDER_ID,
      p_service_id: "1",
      p_service_name: "PAC",
      p_price: 27.48,
      p_estimated_days: 10,
    });
  });

  it("uses service_role, never a client-facing anon call", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue({ rpc } as never);

    await applyMelhorEnvioShippingToOrder(TENANT_ID, ORDER_ID, { serviceId: "1", name: "PAC", price: 27.48, estimatedDays: 10 });
    expect(createSupabaseServiceRoleClient).toHaveBeenCalledTimes(1);
  });

  it("returns a friendly error, never the raw Postgres message, when the RPC fails", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: "order can no longer be changed" } });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue({ rpc } as never);

    const result = await applyMelhorEnvioShippingToOrder(TENANT_ID, ORDER_ID, { serviceId: "1", name: "PAC", price: 27.48, estimatedDays: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toMatch(/order can no longer be changed/);
    }
  });
});
