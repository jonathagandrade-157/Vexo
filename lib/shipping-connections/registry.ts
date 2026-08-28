import "server-only";

import { getMelhorEnvioEnv } from "@/lib/env";
import type { ShippingConnectionGateway, ShippingConnectionProvider } from "./gateway";
import { createMelhorEnvioGateway } from "./melhorenvio";

/**
 * Único ponto que sabe instanciar cada gateway de conexão de frete —
 * Server Action/Route Handler chamam só `getShippingConnectionGateway(provider)`,
 * nunca importam `melhorenvio.ts` diretamente (mesmo desenho de
 * lib/payments/registry.ts).
 */
export function getShippingConnectionGateway(provider: ShippingConnectionProvider): ShippingConnectionGateway {
  switch (provider) {
    case "melhor_envio": {
      const env = getMelhorEnvioEnv();
      return createMelhorEnvioGateway(env.MELHOR_ENVIO_CLIENT_ID, env.MELHOR_ENVIO_CLIENT_SECRET, env.MELHOR_ENVIO_SANDBOX);
    }
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unknown shipping connection provider: ${exhaustive as string}`);
    }
  }
}
