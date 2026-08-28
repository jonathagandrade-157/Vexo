import "server-only";

import type { ShippingProvider, ShippingProviderType } from "./provider";
import { createFlatRateProvider } from "./flat-rate";
import { createMelhorEnvioProvider } from "./melhor-envio";

/**
 * Único ponto que sabe instanciar cada provedor de frete — cotação/
 * checkout chamam só `getShippingProvider(type)`, nunca importam
 * `flat-rate.ts`/`melhor-envio.ts` diretamente (mesmo padrão de
 * lib/payments/registry.ts, Etapa 11). Um terceiro provedor entra depois
 * é só um novo `case` aqui + um novo arquivo de implementação.
 */
export function getShippingProvider(type: ShippingProviderType): ShippingProvider {
  switch (type) {
    case "flat_rate":
      return createFlatRateProvider();
    case "melhor_envio":
      return createMelhorEnvioProvider();
    default: {
      const exhaustive: never = type;
      throw new Error(`Unknown shipping provider type: ${exhaustive as string}`);
    }
  }
}
