import "server-only";

import { cache } from "react";

import { createSupabasePublicClient } from "@/lib/supabase/server";
import { resolveStorefrontTenant } from "@/features/storefront/resolve-tenant";
import { getCartId } from "./cart-cookie";
import { cartSubtotal } from "./pricing";

export interface CartItemProduct {
  id: string;
  name: string;
  slug: string;
  price: number;
  promotional_price: number | null;
  main_image: string | null;
}

export interface CartItemView {
  id: string;
  quantity: number;
  /** Produto ainda ativo — um item cujo produto foi desativado depois de adicionado continua visível (para o visitante remover), mas sai do subtotal (arquitetura Etapa 9 §6). */
  available: boolean;
  product: CartItemProduct;
}

export interface CartView {
  items: CartItemView[];
  /** Soma de quantidades de TODOS os itens (mesmo indisponíveis) — "quantas coisas estão no carrinho", distinto do subtotal monetário. */
  itemCount: number;
  subtotal: number;
}

const EMPTY_CART: CartView = { items: [], itemCount: 0, subtotal: 0 };

interface ProductJoinRow {
  id: string;
  quantity: number;
  product:
    | (CartItemProduct & { status: string })
    | (CartItemProduct & { status: string })[]
    | null;
}

function firstProduct(row: ProductJoinRow["product"]): (CartItemProduct & { status: string }) | null {
  const p = Array.isArray(row) ? row[0] : row;
  return p ?? null;
}

/**
 * Sempre resolve o tenant pelo slug (nunca aceita um tenant_id de fora)
 * e sempre escopa a leitura por `tenant_id` além de `cart_id` (defesa em
 * profundidade, além da RLS) — arquitetura Etapa 9 §7. `cache()` dedupe
 * dentro do mesmo request (ex.: contador do header + conteúdo da
 * página do carrinho).
 */
export const getCart = cache(async (storeSlug: string): Promise<CartView> => {
  const resolution = await resolveStorefrontTenant(storeSlug);
  if (resolution.status !== "ready") return EMPTY_CART;

  const cartId = await getCartId(storeSlug);
  if (!cartId) return EMPTY_CART;

  const supabase = createSupabasePublicClient();
  const { data } = await supabase
    .from("cart_items")
    .select("id, quantity, product:products(id, name, slug, price, promotional_price, main_image, status)")
    .eq("cart_id", cartId)
    .eq("tenant_id", resolution.tenant.id)
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as unknown as ProductJoinRow[];
  const items: CartItemView[] = rows
    .map((row) => {
      const product = firstProduct(row.product);
      if (!product) return null; // produto excluído — cascata já removeu a linha, mas defensivo contra corrida de leitura
      const { status, ...productFields } = product;
      return { id: row.id, quantity: row.quantity, available: status === "active", product: productFields };
    })
    .filter((item): item is CartItemView => item !== null);

  return {
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: cartSubtotal(items),
  };
});
