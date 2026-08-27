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
 *
 * D3.1: retirada na loja e entrega própria não são novos *provedores* —
 * são só novos valores de `shipping_methods.type`, lidos pelo mesmo
 * provedor `flat_rate` (que já busca todas as modalidades ativas do
 * tenant sem filtrar por tipo). `ShippingMethodType` é essa modalidade;
 * `ShippingProviderType` continua sendo o mecanismo de cotação.
 */

export type ShippingProviderType = "flat_rate";

export type ShippingMethodType = "flat_rate" | "own_delivery" | "pickup";

export interface ShippingQuoteOption {
  /** Id da modalidade (shipping_methods.id) — usado depois em apply_shipping_to_order. */
  id: string;
  name: string;
  price: number;
  estimatedDays: number | null;
  /**
   * Modalidade (shipping_methods.type). `pickup` não representa uma
   * entrega no endereço do cliente — o checkout usa isso para decidir se
   * pede o endereço de entrega ou mostra o endereço da loja.
   */
  type: ShippingMethodType;
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
