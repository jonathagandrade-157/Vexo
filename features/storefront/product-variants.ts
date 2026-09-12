import "server-only";

import { cache } from "react";

import { createSupabasePublicClient } from "@/lib/supabase/server";

/**
 * D20.6 Fase 3.4 — leitura pública de opções/valores/variantes (D20.1/D20.2)
 * para a página de produto do storefront. Mesmo padrão de
 * features/storefront/catalog.ts (cache() + createSupabasePublicClient,
 * nunca o client de sessão do painel): `tenantId`/`productId` sempre vêm de
 * `resolveStorefrontTenant(slug)`/`getStorefrontProduct` já resolvidos, e
 * toda query é escopada por eles além da RLS pública (defesa em
 * profundidade, mesma convenção do resto do arquivo de catálogo). RLS
 * pública de product_variants (migration 20260817220115) já exige
 * `is_active = true` + produto ativo + tenant publicado — o `.eq("is_active", true)`
 * abaixo é reforço explícito, não a única barreira.
 */

export interface PublicOptionValue {
  id: string;
  value: string;
  position: number;
}

export interface PublicProductOption {
  id: string;
  name: string;
  position: number;
  values: PublicOptionValue[];
}

export interface PublicProductVariant {
  id: string;
  sku: string | null;
  price: number;
  promotionalPrice: number | null;
  /** Forma canônica (D20 §C) — a mesma já usada no painel (features/products/variant-combinations.ts) para resolver a combinação selecionada. */
  optionValueIds: string[];
  /** Mesmo critério de PublicProduct.inStock (features/storefront/catalog.ts): ausência de linha em product_inventory = não controlado = sempre disponível; só `false` quando há uma linha PARA ESTA VARIANTE com stock_quantity = 0. */
  inStock: boolean;
}

export interface PublicProductVariantsData {
  options: PublicProductOption[];
  variants: PublicProductVariant[];
}

const EMPTY: PublicProductVariantsData = { options: [], variants: [] };

interface StockJoinRow {
  product_inventory: { stock_quantity: number } | { stock_quantity: number }[] | null;
}

interface VariantRow {
  id: string;
  sku: string | null;
  price: number;
  promotional_price: number | null;
  option_value_ids: string[];
}

function isInStock(row: StockJoinRow["product_inventory"]): boolean {
  const inv = Array.isArray(row) ? row[0] : row;
  if (!inv) return true;
  return inv.stock_quantity > 0;
}

/**
 * Opções+valores sempre via duas queries simples seguidas de junção em
 * memória (nunca um select aninhado product_options→product_option_values
 * do PostgREST) — mesma cautela já documentada em
 * features/products/variants-data.ts contra a ambiguidade array-vs-objeto
 * de embeds aninhados do PostgREST.
 */
export const getStorefrontProductVariantsData = cache(
  async (tenantId: string, productId: string): Promise<PublicProductVariantsData> => {
    const supabase = createSupabasePublicClient();

    const { data: optionRows } = await supabase
      .from("product_options")
      .select("id, name, position")
      .eq("tenant_id", tenantId)
      .eq("product_id", productId);

    const options = ((optionRows ?? []) as { id: string; name: string; position: number }[])
      .slice()
      .sort((a, b) => a.position - b.position);

    if (options.length === 0) return EMPTY;

    const { data: valueRows } = await supabase
      .from("product_option_values")
      .select("id, value, position, product_option_id")
      .eq("tenant_id", tenantId)
      .in(
        "product_option_id",
        options.map((option) => option.id),
      );

    const values = (valueRows ?? []) as { id: string; value: string; position: number; product_option_id: string }[];

    const optionsWithValues: PublicProductOption[] = options.map((option) => ({
      id: option.id,
      name: option.name,
      position: option.position,
      values: values
        .filter((value) => value.product_option_id === option.id)
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((value) => ({ id: value.id, value: value.value, position: value.position })),
    }));

    const { data: variantRows } = await supabase
      .from("product_variants")
      .select("id, sku, price, promotional_price, option_value_ids, product_inventory(stock_quantity)")
      .eq("tenant_id", tenantId)
      .eq("product_id", productId)
      .eq("is_active", true);

    const variants: PublicProductVariant[] = (
      (variantRows ?? []) as unknown as (VariantRow & StockJoinRow)[]
    ).map((row) => ({
      id: row.id,
      sku: row.sku,
      price: row.price,
      promotionalPrice: row.promotional_price,
      optionValueIds: row.option_value_ids,
      inStock: isInStock(row.product_inventory),
    }));

    return { options: optionsWithValues, variants };
  },
);
