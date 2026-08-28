import "server-only";

import { buildMelhorEnvioProductsFromCart } from "@/features/shipping/melhor-envio-cart-products";
import { pricesMatchExactly } from "@/lib/utils/money";
import { calculateShipmentQuote } from "@/lib/shipping-connections/melhorenvio-quote";
import { createSupabasePublicClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * D3.2-B Ponto 2E — revalidação/aplicação server-side da cotação Melhor
 * Envio no fechamento do pedido. Espelha o PAPEL de
 * `features/shipping/checkout.ts` (`verifyShippingPriceFresh`/
 * `applyShippingToOrder`), mas nunca a implementação: aquele par relê
 * `shipping_methods.price` dentro do Postgres como fonte de verdade;
 * para Melhor Envio a fonte de verdade é sempre uma chamada HTTP fresca
 * a `calculateShipmentQuote()` (nunca uma linha de banco, nunca uma
 * cotação antiga guardada, nunca cache).
 *
 * REGRA FUNDAMENTAL: preço, serviceId e prazo que o navegador informar
 * NUNCA são a autoridade — servem só para: (a) saber qual opção o
 * cliente quis escolher (serviceId) e (b) detectar divergência de preço
 * (nunca para decidir o valor final). O valor realmente aplicado ao
 * pedido é sempre o que a nova chamada devolveu.
 */

export type MelhorEnvioShippingCheck =
  | { valid: true; serviceId: string; name: string; price: number; estimatedDays: number | null }
  | {
      valid: false;
      reason:
        | "empty_cart"
        | "incomplete_product_data"
        | "origin_not_configured"
        | "not_connected"
        | "needs_reconnection"
        | "temporarily_unavailable"
        | "upstream_error"
        | "service_unavailable"
        | "price_changed";
    };

/**
 * Mesma leitura/mesma regra de `lib/shipping/melhor-envio.ts::getOriginZip`
 * (não reexportada de lá de propósito — aquele arquivo é o provider de
 * COTAÇÃO, não o de FECHAMENTO; ambos leem a mesma fonte já decidida,
 * `shipping_settings.origin_zip`, sem depender um do outro).
 */
async function getOriginZip(tenantId: string): Promise<string | null> {
  const supabase = createSupabasePublicClient();
  const { data } = await supabase.from("shipping_settings").select("enabled, origin_zip").eq("tenant_id", tenantId).maybeSingle();
  if (!data?.enabled || !data.origin_zip) return null;
  return data.origin_zip;
}

/**
 * D3.2-B Ponto 2D — mesmo conjunto mínimo de services usado na cotação
 * (`lib/shipping/melhor-envio.ts`), reaplicado aqui: a recotação de
 * fechamento precisa pedir exatamente os mesmos serviços que a cotação
 * original ofereceu, senão o `serviceId` escolhido pelo cliente nunca
 * apareceria na nova resposta mesmo estando genuinamente disponível.
 */
const DEFAULT_MELHOR_ENVIO_SERVICES = [1, 2];

/**
 * Revalida a escolha do cliente com uma cotação Melhor Envio
 * COMPLETAMENTE NOVA (nunca a de `/api/shipping/quote`, nunca cache).
 * Chamado ANTES de `create_order_from_cart` (mesmo ponto onde
 * `verifyShippingPriceFresh` roda para `flat_rate`) — se inválido, o
 * pedido nem chega a ser criado (nunca um pedido órfão, nunca um
 * fallback silencioso para `flat_rate`).
 *
 * `tenantId`/`cartId`/`destinationZip` são sempre resolvidos pelo
 * CHAMADOR a partir do contexto seguro existente (nunca aceitos soltos
 * aqui) — `chosenServiceId`/`expectedPrice` são os únicos valores vindos
 * do cliente, e `expectedPrice` só é usado para detectar divergência.
 */
export async function verifyMelhorEnvioShippingFresh(
  tenantId: string,
  cartId: string,
  destinationZip: string,
  chosenServiceId: string,
  expectedPrice: number,
): Promise<MelhorEnvioShippingCheck> {
  const originZip = await getOriginZip(tenantId);
  if (!originZip) return { valid: false, reason: "origin_not_configured" };

  const productsResult = await buildMelhorEnvioProductsFromCart(tenantId, cartId);
  if (productsResult.status === "unavailable") return { valid: false, reason: productsResult.reason };

  const quote = await calculateShipmentQuote({
    tenantId,
    originZip,
    destinationZip,
    products: productsResult.products,
    services: DEFAULT_MELHOR_ENVIO_SERVICES,
  });

  if (quote.status === "unavailable") return { valid: false, reason: quote.reason };

  const chosen = quote.options.find((option) => option.serviceId === chosenServiceId);
  if (!chosen) return { valid: false, reason: "service_unavailable" };

  if (!pricesMatchExactly(chosen.price, expectedPrice)) return { valid: false, reason: "price_changed" };

  // O valor devolvido é sempre o da cotação FRESCA — nunca `expectedPrice`
  // (que já serviu só para detectar divergência acima, mesmo princípio
  // de `apply_shipping_to_order` com `p_expected_price`).
  return { valid: true, serviceId: chosen.serviceId, name: chosen.name, price: chosen.price, estimatedDays: chosen.deliveryTime };
}

/**
 * Grava no pedido um resultado JÁ revalidado por `verifyMelhorEnvioShippingFresh`
 * NA MESMA REQUISIÇÃO — nunca chamado com um valor vindo de qualquer
 * outro lugar (nunca `expectedPrice` do cliente, nunca uma cotação
 * antiga). Usa `service_role` (nunca `anon`) porque a RPC
 * `apply_melhor_envio_shipping_to_order` não tem como revalidar o preço
 * sozinha (não existe uma tabela `shipping_methods`-like para Melhor
 * Envio) — a única proteção real é este módulo nunca chamá-la com um
 * valor não verificado, e a RPC ser inacessível a qualquer chamador
 * externo (`anon`/`authenticated` não têm `EXECUTE`).
 */
export async function applyMelhorEnvioShippingToOrder(
  tenantId: string,
  orderId: string,
  verified: { serviceId: string; name: string; price: number; estimatedDays: number | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase.rpc("apply_melhor_envio_shipping_to_order", {
    p_tenant_id: tenantId,
    p_order_id: orderId,
    p_service_id: verified.serviceId,
    p_service_name: verified.name,
    p_price: verified.price,
    p_estimated_days: verified.estimatedDays,
  });

  if (error) {
    if (error.message.includes("order has no shipping address for this method")) {
      return { ok: false, error: "Esta opção de entrega exige um endereço. Volte e informe o endereço de entrega." };
    }
    return { ok: false, error: "Não foi possível aplicar o frete a este pedido. Tente novamente." };
  }

  return { ok: true };
}
