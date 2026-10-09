import "server-only";

import { createSupabasePublicClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { ShippingMethodType } from "@/lib/shipping/provider";

/**
 * Loja exige seleção de frete no checkout? (achado da revisão de
 * segurança da Etapa 12: sem esta checagem, bastava o cliente omitir
 * `shippingMethodId`/`shippingPrice` no POST — inclusive fora do
 * formulário, direto no Server Action — para finalizar o pedido com
 * `shipping_total = 0` mesmo numa loja com entrega paga configurada
 * como obrigatória.) Só a existência de `shipping_settings.enabled =
 * true` importa aqui — nenhuma modalidade ativa com `enabled = true`
 * já é sinalizado ao cliente como "unavailable" na cotação, então a
 * própria escolha de finalizar sem frete já não é mais possível pela UI
 * normal nesse caso; aqui é a garantia do lado do servidor.
 */
export async function isShippingRequired(tenantId: string): Promise<boolean> {
  const supabase = createSupabasePublicClient();
  const { data } = await supabase
    .from("shipping_settings")
    .select("enabled")
    .eq("tenant_id", tenantId)
    .eq("enabled", true)
    .maybeSingle();
  return Boolean(data);
}

export type ShippingPriceCheck = { valid: true; type: ShippingMethodType } | { valid: false };

/**
 * Pré-validação ANTES de criar o pedido (prompt §23: "se o valor tiver
 * mudado, não criar silenciosamente um pedido com valor diferente" —
 * avisar o cliente em vez de aplicar). Lê a modalidade ao vivo via `anon`
 * (mesmas policies RLS do storefront) e compara com o preço que o cliente
 * viu na tela. Isto NÃO substitui a revalidação atômica de
 * `apply_shipping_to_order` (migration 048) — é uma segunda checagem,
 * antes, para evitar criar um pedido "órfão" (sem frete aplicável) quando
 * o preço já mudou.
 *
 * D3.1: também devolve o `type` real da modalidade (nunca o que o cliente
 * enviou) — o Server Action usa isso para decidir se o endereço de entrega
 * é obrigatório (retirada na loja não pede endereço do cliente).
 */
export async function verifyShippingPriceFresh(
  tenantId: string,
  shippingMethodId: string,
  expectedPrice: number,
): Promise<ShippingPriceCheck> {
  const supabase = createSupabasePublicClient();
  const { data } = await supabase
    .from("shipping_methods")
    .select("price, type")
    .eq("id", shippingMethodId)
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .maybeSingle();

  if (!data) return { valid: false };
  if (Math.abs(data.price - expectedPrice) > 0.01) return { valid: false };
  return { valid: true, type: data.type as ShippingMethodType };
}

/**
 * Adaptador server-only da RPC de frete. Desde a Etapa 2A ela é
 * service-role-only e, no checkout normal, é composta atomicamente por
 * checkout_cart_secure. Mantida exportada para recuperação operacional
 * e testes focados da regra anti-manipulação.
 */
export async function applyShippingToOrder(
  tenantId: string,
  orderId: string,
  shippingMethodId: string,
  expectedPrice: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase.rpc("apply_shipping_to_order", {
    p_tenant_id: tenantId,
    p_order_id: orderId,
    p_shipping_method_id: shippingMethodId,
    p_expected_price: expectedPrice,
  });

  if (error) {
    if (error.message.includes("shipping price has changed")) {
      return { ok: false, error: "O valor do frete mudou. Volte e selecione a opção de entrega novamente." };
    }
    if (error.message.includes("shipping method not available")) {
      return { ok: false, error: "Esta opção de entrega não está mais disponível. Selecione outra." };
    }
    if (error.message.includes("order has no shipping address for this method")) {
      return { ok: false, error: "Esta opção de entrega exige um endereço. Volte e informe o endereço de entrega." };
    }
    return { ok: false, error: "Não foi possível aplicar o frete a este pedido. Tente novamente." };
  }

  return { ok: true };
}
