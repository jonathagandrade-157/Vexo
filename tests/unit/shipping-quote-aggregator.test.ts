import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * D3.2-B Ponto 2D — `getShippingQuote` (`features/shipping/quote.ts`)
 * passa a combinar `flat_rate` + `melhor_envio`. `getShippingProvider` é
 * mockado inteiro (cada provider concreto já é testado isoladamente —
 * `flat-rate.ts` via `tests/integration/shipping.test.ts`,
 * `melhor-envio.ts` via `tests/unit/melhor-envio-provider.test.ts`) —
 * aqui o foco é só a lógica de combinação em si.
 */
vi.mock("@/lib/shipping/registry", () => ({ getShippingProvider: vi.fn() }));

import { getShippingProvider } from "@/lib/shipping/registry";
import { getShippingQuote } from "@/features/shipping/quote";
import type { ShippingQuoteResult } from "@/lib/shipping/provider";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const CART_ID = "22222222-2222-2222-2222-222222222222";
const ZIP = "11111111";

const FLAT_RATE_OPTION = { id: "method-1", name: "Entrega padrão", price: 15, estimatedDays: 5, type: "flat_rate" as const };
const PICKUP_OPTION = { id: "method-2", name: "Retirar na loja", price: 0, estimatedDays: null, type: "pickup" as const };
const OWN_DELIVERY_OPTION = { id: "method-3", name: "Entrega própria", price: 10, estimatedDays: 1, type: "own_delivery" as const };
const MELHOR_ENVIO_OPTION = { id: "1", name: "PAC", price: 27.48, estimatedDays: 10, type: "melhor_envio" as const };

function mockProviders(flatRate: ShippingQuoteResult, melhorEnvio: ShippingQuoteResult) {
  vi.mocked(getShippingProvider).mockImplementation((type) => ({
    type,
    getQuote: vi.fn().mockResolvedValue(type === "flat_rate" ? flatRate : melhorEnvio),
  }));
}

describe("getShippingQuote (D3.2-B Ponto 2D — combinação de providers)", () => {
  afterEach(() => {
    vi.mocked(getShippingProvider).mockReset();
  });

  it("15/16/17. flat_rate/pickup/own_delivery continuam funcionando quando Melhor Envio não tem nada a oferecer", async () => {
    mockProviders({ status: "ok", options: [FLAT_RATE_OPTION, PICKUP_OPTION, OWN_DELIVERY_OPTION] }, { status: "unavailable" });

    const result = await getShippingQuote(TENANT_ID, ZIP, CART_ID);
    expect(result).toEqual({ status: "ok", options: [FLAT_RATE_OPTION, PICKUP_OPTION, OWN_DELIVERY_OPTION] });
  });

  it("combina as opções de flat_rate e melhor_envio quando ambos têm algo a oferecer", async () => {
    mockProviders({ status: "ok", options: [FLAT_RATE_OPTION] }, { status: "ok", options: [MELHOR_ENVIO_OPTION] });

    const result = await getShippingQuote(TENANT_ID, ZIP, CART_ID);
    expect(result).toEqual({ status: "ok", options: [FLAT_RATE_OPTION, MELHOR_ENVIO_OPTION] });
  });

  it("11. Melhor Envio indisponível/erro nunca quebra o endpoint — flat_rate continua sendo retornado normalmente", async () => {
    mockProviders({ status: "ok", options: [FLAT_RATE_OPTION] }, { status: "unavailable" });

    const result = await getShippingQuote(TENANT_ID, ZIP, CART_ID);
    expect(result).toEqual({ status: "ok", options: [FLAT_RATE_OPTION] });
  });

  it("quando shipping_settings está desabilitado (flat_rate=disabled), o resultado combinado é disabled — mesmo se melhor_envio (hipoteticamente) retornasse algo", async () => {
    mockProviders({ status: "disabled" }, { status: "ok", options: [MELHOR_ENVIO_OPTION] });

    const result = await getShippingQuote(TENANT_ID, ZIP, CART_ID);
    expect(result).toEqual({ status: "disabled" });
  });

  it("quando nenhum provider tem opções, o resultado é unavailable (nunca ok com array vazio nem disabled por engano)", async () => {
    mockProviders({ status: "unavailable" }, { status: "unavailable" });

    const result = await getShippingQuote(TENANT_ID, ZIP, CART_ID);
    expect(result).toEqual({ status: "unavailable" });
  });

  it("passa tenantId/destinationZip/cartId iguais para os dois providers (isolamento e consistência de contexto)", async () => {
    mockProviders({ status: "unavailable" }, { status: "unavailable" });
    await getShippingQuote(TENANT_ID, ZIP, CART_ID);

    for (const call of vi.mocked(getShippingProvider).mock.results) {
      expect(call.value.getQuote).toHaveBeenCalledWith(TENANT_ID, ZIP, CART_ID);
    }
  });
});
