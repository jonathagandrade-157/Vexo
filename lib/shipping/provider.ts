import "server-only";

/**
 * Abstração de provedor de frete (mesmo desenho de lib/payments/gateway.ts,
 * Etapa 11) — checkout/cotação falam só com esta interface, nunca com uma
 * implementação concreta diretamente. Só `flat_rate` é implementado nesta
 * etapa (`flat-rate.ts`): não há credenciais reais de Correios/Melhor
 * Envio disponíveis, então nenhuma integração de transportadora é
 * inventada (prompt Etapa 12 §6/§27). Um provedor real de transportadora
 * entra depois só adicionando um novo arquivo + um `case` em
 * `registry.ts`, sem tocar checkout/cotação.
 */

export type ShippingProviderType = "flat_rate";

export interface ShippingQuoteOption {
  /** Id da modalidade (shipping_methods.id) — usado depois em apply_shipping_to_order. */
  id: string;
  name: string;
  price: number;
  estimatedDays: number | null;
}

export type ShippingQuoteResult =
  | { status: "disabled" }
  | { status: "unavailable" }
  | { status: "ok"; options: ShippingQuoteOption[] };

export interface ShippingProvider {
  readonly type: ShippingProviderType;
  /**
   * `destinationZip` já normalizado (8 dígitos, sem máscara) — cada
   * implementação decide se usa o CEP para variar o preço (Correios/Melhor
   * Envio, no futuro) ou não (flat_rate, nesta etapa: preço fixo definido
   * pelo lojista, independente do CEP do cliente).
   */
  getQuote(tenantId: string, destinationZip: string): Promise<ShippingQuoteResult>;
}
