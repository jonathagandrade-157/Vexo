import "server-only";

import { getMercadoPagoEnv } from "@/lib/env";
import type { PaymentGateway, PaymentProvider } from "./gateway";
import { createMercadoPagoGateway } from "./mercadopago";

/**
 * Único ponto que sabe instanciar cada gateway — checkout/OAuth/webhook
 * chamam só `getGateway(provider)`, nunca importam `mercadopago.ts`
 * diretamente. Adicionar PagBank/Asaas/Stripe depois é só um novo
 * `case` aqui + um novo arquivo de implementação (arquitetura §2).
 */
export function getGateway(provider: PaymentProvider): PaymentGateway {
  switch (provider) {
    case "mercadopago": {
      const env = getMercadoPagoEnv();
      return createMercadoPagoGateway(env.MERCADO_PAGO_CLIENT_ID, env.MERCADO_PAGO_CLIENT_SECRET, env.MERCADO_PAGO_WEBHOOK_SECRET);
    }
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unknown payment provider: ${exhaustive as string}`);
    }
  }
}
