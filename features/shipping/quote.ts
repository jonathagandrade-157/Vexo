import "server-only";

import { getShippingProvider } from "@/lib/shipping/registry";
import type { ShippingQuoteResult } from "@/lib/shipping/provider";

/**
 * Ponto único usado pelo Route Handler de cotação (`/api/shipping/quote`)
 * e pelo checkout — sempre passa pelo `ShippingProvider` (nunca lê
 * `shipping_methods`/vault/API do Melhor Envio diretamente), mesmo
 * padrão de `features/payments/checkout.ts::isPaymentGatewayConnected`
 * delegando ao gateway.
 *
 * D3.2-B Ponto 2D — combina as opções de TODOS os provedores em um único
 * resultado (antes só `flat_rate` existia). `flat_rate` continua sendo o
 * sinal mestre de "loja tem entrega habilitada": se ele reportar
 * `disabled` (`shipping_settings.enabled` ausente/false), o resultado
 * combinado também é `disabled` — nenhum outro provedor teria nada a
 * oferecer de qualquer forma (Melhor Envio depende do mesmo
 * `shipping_settings.enabled`, ver `lib/shipping/melhor-envio.ts`).
 * Fora esse caso, as opções `ok` de cada provedor são somadas; um
 * provedor `unavailable` simplesmente não contribui nenhuma opção —
 * nunca derruba os demais. Se a soma final ficar vazia, o resultado é
 * `unavailable` (nenhum provedor teve nada a oferecer para este CEP/
 * carrinho); com pelo menos uma opção, o resultado é `ok`.
 */
export async function getShippingQuote(tenantId: string, destinationZip: string, cartId: string | null): Promise<ShippingQuoteResult> {
  const flatRate = await getShippingProvider("flat_rate").getQuote(tenantId, destinationZip, cartId);
  const melhorEnvio = await getShippingProvider("melhor_envio").getQuote(tenantId, destinationZip, cartId);

  if (flatRate.status === "disabled") return flatRate;

  const options = [
    ...(flatRate.status === "ok" ? flatRate.options : []),
    ...(melhorEnvio.status === "ok" ? melhorEnvio.options : []),
  ];

  if (options.length === 0) return { status: "unavailable" };
  return { status: "ok", options };
}
