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

/** D20.4 — presente só quando o item representa uma combinação específica de product_variants; price/promotional_price aqui (nunca os do produto-pai) são o que é efetivamente cobrado. */
export interface CartItemVariant {
  id: string;
  sku: string | null;
  price: number;
  promotional_price: number | null;
}

export interface CartItemView {
  id: string;
  quantity: number;
  /** Produto ainda ativo E, se houver variante, variante ainda ativa — um item cujo produto/variante foi desativado depois de adicionado continua visível (para o visitante remover), mas sai do subtotal (arquitetura Etapa 9 §6, estendida em D20.4). */
  available: boolean;
  product: CartItemProduct;
  /**
   * D20.4 — a própria coluna cart_items.variant_id, sempre presente
   * quando o item é de variante, MESMO que `variant` abaixo seja `null`
   * (variante desativada/removida depois de adicionada ao carrinho —
   * correção MEDIUM-1 da revisão de segurança). É o que garante que um
   * item de variante indisponível continua identificável como "era uma
   * variante", nunca confundido com produto simples.
   */
  variantId: string | null;
  /** D20.4 — dados completos da variante, só quando ela existe e está ativa. `null` para produto simples E para variante indisponível — nesses dois casos o produto-base NUNCA substitui silenciosamente o preço/dado da variante (ver `variantId` acima para diferenciar os dois). */
  variant: CartItemVariant | null;
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
  /**
   * D20.4 (correção MEDIUM-1 da revisão) — coluna PRÓPRIA de cart_items,
   * lida direto (nunca só via o embed `variant` abaixo). É a única fonte
   * confiável para saber se este item TEM uma variante: o embed
   * `variant:product_variants(...)` é filtrado pela RLS pública de
   * product_variants (D20.2, exige is_active=true) e por isso retorna
   * `null` tanto quando não há variante quanto quando há uma variante
   * que ficou inativa depois de adicionada ao carrinho — as duas
   * situações são indistinguíveis olhando só para `row.variant`.
   */
  variant_id: string | null;
  product:
    | (CartItemProduct & { status: string })
    | (CartItemProduct & { status: string })[]
    | null;
  variant:
    | (CartItemVariant & { is_active: boolean })
    | (CartItemVariant & { is_active: boolean })[]
    | null;
}

function firstProduct(row: ProductJoinRow["product"]): (CartItemProduct & { status: string }) | null {
  const p = Array.isArray(row) ? row[0] : row;
  return p ?? null;
}

function firstVariant(row: ProductJoinRow["variant"]): (CartItemVariant & { is_active: boolean }) | null {
  const v = Array.isArray(row) ? row[0] : row;
  return v ?? null;
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
    .select(
      "id, quantity, variant_id, product:products(id, name, slug, price, promotional_price, main_image, status), variant:product_variants(id, sku, price, promotional_price, is_active)",
    )
    .eq("cart_id", cartId)
    .eq("tenant_id", resolution.tenant.id)
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as unknown as ProductJoinRow[];
  const items: CartItemView[] = rows
    .map((row) => {
      const product = firstProduct(row.product);
      if (!product) return null; // produto excluído — cascata já removeu a linha, mas defensivo contra corrida de leitura
      const { status, ...productFields } = product;

      // D20.4 (correção MEDIUM-1) — a decisão "este item é de variante?"
      // usa SEMPRE row.variant_id (coluna própria de cart_items, nunca
      // filtrada por RLS de outra tabela), nunca a mera presença do
      // embed. Três casos, nunca confundidos entre si:
      //   1. variant_id NULL → produto simples, comportamento de Etapa 9
      //      intacto (nunca passa por aqui uma variante "fantasma").
      //   2. variant_id preenchido E o embed trouxe a variante (ativa,
      //      visível pela RLS pública) → usa o preço/dados da variante,
      //      NUNCA os do produto-pai (regra "variante deve prevalecer").
      //   3. variant_id preenchido MAS o embed veio nulo (variante
      //      desativada, ou removida, depois de adicionada ao carrinho)
      //      → indisponível, e o produto-base NUNCA substitui
      //      silenciosamente a variante ausente (variant fica null,
      //      subtotal exclui o item via `available=false`, nunca cai no
      //      preço do produto-pai como se fosse produto simples).
      let variant: CartItemVariant | null = null;
      let available: boolean;
      if (row.variant_id === null) {
        available = status === "active";
      } else {
        const variantRow = firstVariant(row.variant);
        if (variantRow && variantRow.is_active) {
          const { is_active, ...variantFields } = variantRow;
          variant = variantFields;
          available = status === "active";
        } else {
          available = false;
        }
      }

      return { id: row.id, quantity: row.quantity, available, product: productFields, variantId: row.variant_id, variant };
    })
    .filter((item): item is CartItemView => item !== null);

  return {
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: cartSubtotal(items),
  };
});
