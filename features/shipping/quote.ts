import "server-only";

import { getShippingProvider } from "@/lib/shipping/registry";
import type { ShippingQuoteResult } from "@/lib/shipping/provider";

/**
 * Ponto único usado pelo Route Handler de cotação (`/api/shipping/quote`)
 * e pelo checkout — sempre passa pelo `ShippingProvider` (nunca lê
 * `shipping_methods` diretamente), mesmo padrão de
 * `features/payments/checkout.ts::isPaymentGatewayConnected` delegando ao
 * gateway. Só `flat_rate` existe nesta etapa (prompt §6/§27).
 */
export async function getShippingQuote(tenantId: string, destinationZip: string): Promise<ShippingQuoteResult> {
  const provider = getShippingProvider("flat_rate");
  return provider.getQuote(tenantId, destinationZip);
}
