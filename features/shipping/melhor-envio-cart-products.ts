import "server-only";

import { effectivePrice } from "@/features/cart/pricing";
import type { ShipmentQuoteProduct } from "@/lib/shipping-connections/melhorenvio-quote";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * D3.2-B Ponto 2C — monta `products[]` (o payload de cotação do Melhor
 * Envio) a partir de `cart_items`/`products` já persistidos no banco.
 * Nunca aceita peso/dimensão/preço/quantidade vindos do navegador — tudo
 * é relido aqui, mesmo padrão de `features/cart/data.ts::getCart` e de
 * `create_order_from_cart` (nunca confiar em cart_items para preço, que
 * nem armazena isso — Etapa 9).
 *
 * A leitura usa service_role porque cart_items não é mais público desde
 * a Etapa 2A. Todo chamador precisa validar antes a posse por hash do
 * segredo; `tenant_id` + `cart_id` aqui mantêm defesa em profundidade.
 * `prevent_cross_tenant_cart_item` ainda impede mistura estrutural de
 * produto/carrinho/tenant.
 */

export type BuildMelhorEnvioProductsReason = "empty_cart" | "incomplete_product_data";

export type BuildMelhorEnvioProductsResult =
  | { status: "ok"; products: ShipmentQuoteProduct[] }
  | { status: "unavailable"; reason: BuildMelhorEnvioProductsReason };

interface JoinedProduct {
  id: string;
  price: number;
  promotional_price: number | null;
  status: string;
  weight: number | null;
  height: number | null;
  width: number | null;
  length: number | null;
}

interface CartItemRow {
  quantity: number;
  product: JoinedProduct | JoinedProduct[] | null;
}

function firstProduct(value: CartItemRow["product"]): JoinedProduct | null {
  const product = Array.isArray(value) ? value[0] : value;
  return product ?? null;
}

/**
 * Produtos com `status <> 'active'` são excluídos (nunca bloqueiam a
 * cotação inteira) — mesmo tratamento já usado por
 * `features/cart/pricing.ts::cartSubtotal`/`features/cart/data.ts` para
 * um item cujo produto foi desativado depois de adicionado ao carrinho:
 * ele some do cálculo, nunca quebra a visão do carrinho. Reutiliza essa
 * garantia existente em vez de inventar um comportamento novo.
 *
 * Se QUALQUER produto ativo restante tiver weight/height/width/length
 * NULL, a API do Melhor Envio NUNCA é chamada — retorna `unavailable`
 * antes de qualquer chamada de rede (prompt Ponto 2C §8).
 */
export async function buildMelhorEnvioProductsFromCart(tenantId: string, cartId: string): Promise<BuildMelhorEnvioProductsResult> {
  const supabase = createSupabaseServiceRoleClient();
  const { data } = await supabase
    .from("cart_items")
    .select("quantity, product:products(id, price, promotional_price, status, weight, height, width, length)")
    .eq("cart_id", cartId)
    .eq("tenant_id", tenantId);

  const rows = (data ?? []) as unknown as CartItemRow[];
  const activeItems = rows
    .map((row) => ({ quantity: row.quantity, product: firstProduct(row.product) }))
    .filter((item): item is { quantity: number; product: JoinedProduct } => item.product !== null && item.product.status === "active");

  if (activeItems.length === 0) {
    return { status: "unavailable", reason: "empty_cart" };
  }

  const hasIncompleteProduct = activeItems.some(
    ({ product }) => product.weight === null || product.height === null || product.width === null || product.length === null,
  );
  if (hasIncompleteProduct) {
    return { status: "unavailable", reason: "incomplete_product_data" };
  }

  const products: ShipmentQuoteProduct[] = activeItems.map(({ quantity, product }) => ({
    id: product.id,
    // Non-null: já garantido por hasIncompleteProduct acima.
    height: product.height as number,
    width: product.width as number,
    length: product.length as number,
    weight: product.weight as number,
    insuranceValue: effectivePrice({ price: product.price, promotional_price: product.promotional_price }),
    quantity,
  }));

  return { status: "ok", products };
}
