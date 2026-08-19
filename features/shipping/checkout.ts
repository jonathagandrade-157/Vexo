import "server-only";

import { createSupabasePublicClient } from "@/lib/supabase/server";

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

/**
 * Pré-validação ANTES de criar o pedido (prompt §23: "se o valor tiver
 * mudado, não criar silenciosamente um pedido com valor diferente" —
 * avisar o cliente em vez de aplicar). Lê a modalidade ao vivo via `anon`
 * (mesmas policies RLS do storefront) e compara com o preço que o cliente
 * viu na tela. Isto NÃO substitui a revalidação atômica de
 * `apply_shipping_to_order` (migration 048) — é uma segunda checagem,
 * antes, para evitar criar um pedido "órfão" (sem frete aplicável) quando
 * o preço já mudou.
 */
export async function verifyShippingPriceFresh(
  tenantId: string,
  shippingMethodId: string,
  expectedPrice: number,
): Promise<boolean> {
  const supabase = createSupabasePublicClient();
  const { data } = await supabase
    .from("shipping_methods")
    .select("price")
    .eq("id", shippingMethodId)
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .maybeSingle();

  if (!data) return false;
  return Math.abs(data.price - expectedPrice) <= 0.01;
}

/**
 * Aplica o frete escolhido a um pedido PENDING recém-criado (RPC anon,
 * migration 048) — chamado depois de `create_order_from_cart` (Etapa 10,
 * inalterada), antes de `initiatePaymentForOrder` (Etapa 11, inalterada),
 * mesmo encadeamento de passos que o pagamento já usa. Nunca confia em
 * `expectedPrice` como valor final — a função no banco sempre relê o
 * preço atual e só usa esse parâmetro para detectar divergência.
 */
export async function applyShippingToOrder(
  tenantId: string,
  orderId: string,
  shippingMethodId: string,
  expectedPrice: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createSupabasePublicClient();
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
    return { ok: false, error: "Não foi possível aplicar o frete a este pedido. Tente novamente." };
  }

  return { ok: true };
}
