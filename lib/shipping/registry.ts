import "server-only";

import type { ShippingProvider, ShippingProviderType } from "./provider";
import { createFlatRateProvider } from "./flat-rate";

/**
 * Único ponto que sabe instanciar cada provedor de frete — cotação/
 * checkout chamam só `getShippingProvider(type)`, nunca importam
 * `flat-rate.ts` diretamente (mesmo padrão de lib/payments/registry.ts,
 * Etapa 11). Adicionar Correios/Melhor Envio depois é só um novo `case`
 * aqui + um novo arquivo de implementação.
 */
export function getShippingProvider(type: ShippingProviderType): ShippingProvider {
  switch (type) {
    case "flat_rate":
      return createFlatRateProvider();
    default: {
      const exhaustive: never = type;
      throw new Error(`Unknown shipping provider type: ${exhaustive as string}`);
    }
  }
}
