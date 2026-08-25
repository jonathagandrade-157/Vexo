import "server-only";

import { getBillingEnv } from "@/lib/env";
import type { BillingGateway, BillingProvider } from "./gateway";
import { createAsaasGateway } from "./asaas";

/**
 * Único ponto que sabe instanciar cada gateway de BILLING (mesmo padrão
 * de `lib/payments/registry.ts`, mas um registry próprio — Etapa 20.2.5
 * §10: nunca compartilhar com o registry de pagamentos da loja).
 * Adicionar Stripe/Iugu/Pagar.me/PagBank depois é só um novo `case` +
 * um novo arquivo `lib/billing/<provider>.ts`, sem tocar aqui em nada
 * além deste switch — nenhum adapter além de `asaas.ts` é criado nesta
 * etapa.
 */
export function getBillingGateway(provider: BillingProvider): BillingGateway {
  switch (provider) {
    case "asaas": {
      const env = getBillingEnv();
      return createAsaasGateway(env.ASAAS_API_KEY, env.ASAAS_API_URL);
    }
    case "stripe":
    case "iugu":
    case "pagarme":
    case "pagbank":
      throw new Error(`billing: gateway "${provider}" is not implemented yet`);
  }
}
