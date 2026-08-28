import "server-only";

/**
 * Abstração de provedor de frete (mesmo desenho de lib/payments/gateway.ts,
 * Etapa 11) — checkout/cotação falam só com esta interface, nunca com uma
 * implementação concreta diretamente. `flat_rate` (`flat-rate.ts`, preço
 * fixo configurado pelo lojista) e `melhor_envio` (`melhor-envio.ts`,
 * D3.2-B Ponto 2D — cotação real por transportadora) são as duas
 * implementações; um terceiro provedor entra depois só com um novo
 * arquivo + um `case` em `registry.ts`, sem tocar checkout/cotação.
 *
 * D3.1: retirada na loja e entrega própria não são novos *provedores* —
 * são só novos valores de `shipping_methods.type`, lidos pelo mesmo
 * provedor `flat_rate` (que já busca todas as modalidades ativas do
 * tenant sem filtrar por tipo). `ShippingMethodType` é essa modalidade;
 * `ShippingProviderType` continua sendo o mecanismo de cotação.
 */

export type ShippingProviderType = "flat_rate" | "melhor_envio";

/**
 * D3.2-B Ponto 2D: `melhor_envio` foi adicionado para rotular uma opção
 * de cotação por transportadora na resposta de `/api/shipping/quote`.
 * Diferente de `flat_rate`/`own_delivery`/`pickup`, uma opção
 * `melhor_envio` NÃO corresponde a uma linha de `shipping_methods` — seu
 * `id` é o `serviceId` retornado pela API (ex.: "1" = Correios PAC), não
 * um uuid de `shipping_methods.id`. `apply_shipping_to_order` ainda não
 * sabe processar isso (fica para o Ponto 2E — revalidação da cotação no
 * fechamento do pedido, fora do escopo deste ponto).
 */
export type ShippingMethodType = "flat_rate" | "own_delivery" | "pickup" | "melhor_envio";

export interface ShippingQuoteOption {
  /** Id da modalidade (shipping_methods.id) — usado depois em apply_shipping_to_order. Para `type: "melhor_envio"`, é o serviceId da API (ver comentário de ShippingMethodType), não um shipping_methods.id. */
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
   * Envio) ou não (flat_rate: preço fixo definido pelo lojista,
   * independente do CEP do cliente).
   *
   * `cartId` (D3.2-B Ponto 2D) — id do carrinho atual (cookie httpOnly,
   * nunca aceito solto do corpo/query da requisição), `null` quando não
   * há carrinho ainda. `flat_rate` ignora este parâmetro (preço fixo, não
   * depende do carrinho); `melhor_envio` precisa dele para montar
   * `products[]` a partir de `cart_items` — sem carrinho, fica
   * `unavailable`, nunca chama a API.
   */
  getQuote(tenantId: string, destinationZip: string, cartId: string | null): Promise<ShippingQuoteResult>;
}
