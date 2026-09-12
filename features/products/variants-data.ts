import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface ProductOptionValueRow {
  id: string;
  value: string;
  position: number;
}

export interface ProductOptionWithValues {
  id: string;
  name: string;
  position: number;
  values: ProductOptionValueRow[];
}

/** Mesmo padrão de resolveOwnedProduct de features/products/actions.ts — reimplementado aqui (não importado de lá) porque aquele é um helper privado não-exportado do outro arquivo. */
export async function resolveOwnedProduct(
  supabase: SupabaseServerClient,
  tenantId: string,
  productId: string,
): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from("products")
    .select("id")
    .eq("id", productId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data;
}

export async function resolveOwnedOption(
  supabase: SupabaseServerClient,
  tenantId: string,
  optionId: string,
): Promise<{ id: string; productId: string } | null> {
  const { data } = await supabase
    .from("product_options")
    .select("id, product_id")
    .eq("id", optionId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id, productId: data.product_id };
}

/**
 * Duas queries sequenciais, nunca um embed aninhado — mesma cautela já
 * documentada em features/cart/data.ts/features/storefront/catalog.ts
 * contra a ambiguidade array-vs-objeto do PostgREST em selects aninhados.
 */
export async function resolveOwnedOptionValue(
  supabase: SupabaseServerClient,
  tenantId: string,
  valueId: string,
): Promise<{ id: string; optionId: string; productId: string } | null> {
  const { data: valueRow } = await supabase
    .from("product_option_values")
    .select("id, product_option_id")
    .eq("id", valueId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!valueRow) return null;

  const option = await resolveOwnedOption(supabase, tenantId, valueRow.product_option_id);
  if (!option) return null;

  return { id: valueRow.id, optionId: option.id, productId: option.productId };
}

export async function listOptionIdsForProduct(
  supabase: SupabaseServerClient,
  tenantId: string,
  productId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("product_options")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("product_id", productId);
  return ((data ?? []) as { id: string }[]).map((row) => row.id);
}

export async function listValueIdsForOption(
  supabase: SupabaseServerClient,
  tenantId: string,
  optionId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("product_option_values")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("product_option_id", optionId);
  return ((data ?? []) as { id: string }[]).map((row) => row.id);
}

export async function getOptionValues(
  supabase: SupabaseServerClient,
  tenantId: string,
  optionId: string,
): Promise<ProductOptionValueRow[]> {
  const { data } = await supabase
    .from("product_option_values")
    .select("id, value, position")
    .eq("tenant_id", tenantId)
    .eq("product_option_id", optionId);

  return ((data ?? []) as ProductOptionValueRow[]).slice().sort((a, b) => a.position - b.position);
}

// ============================================================
// D20.6 Fase 3.2 — leitura de product_variants (D20.2). Nenhuma escrita
// aqui: a Server Action decide o que criar/atualizar, este módulo só lê o
// estado real do banco (mesmo princípio de resolveOwned*/list* acima).
// ============================================================

export interface ProductVariantRow {
  id: string;
  sku: string | null;
  price: number;
  promotionalPrice: number | null;
  isActive: boolean;
  optionValueIds: string[];
}

export async function resolveOwnedVariant(
  supabase: SupabaseServerClient,
  tenantId: string,
  variantId: string,
): Promise<{ id: string; productId: string } | null> {
  const { data } = await supabase
    .from("product_variants")
    .select("id, product_id")
    .eq("id", variantId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id, productId: data.product_id };
}

/** Preço do produto "pai" — usado como valor inicial das variantes recém-geradas (o lojista ajusta depois, por variante, via updateProductVariantAction). */
export async function getProductPrice(
  supabase: SupabaseServerClient,
  tenantId: string,
  productId: string,
): Promise<number | null> {
  const { data } = await supabase.from("products").select("price").eq("id", productId).eq("tenant_id", tenantId).maybeSingle();
  return data ? data.price : null;
}

export async function getProductVariants(
  supabase: SupabaseServerClient,
  tenantId: string,
  productId: string,
): Promise<ProductVariantRow[]> {
  const { data } = await supabase
    .from("product_variants")
    .select("id, sku, price, promotional_price, is_active, option_value_ids")
    .eq("tenant_id", tenantId)
    .eq("product_id", productId);

  return (
    (data ?? []) as {
      id: string;
      sku: string | null;
      price: number;
      promotional_price: number | null;
      is_active: boolean;
      option_value_ids: string[];
    }[]
  ).map((row) => ({
    id: row.id,
    sku: row.sku,
    price: row.price,
    promotionalPrice: row.promotional_price,
    isActive: row.is_active,
    optionValueIds: row.option_value_ids,
  }));
}

/**
 * Opções do produto + valores de cada uma, ambos já ordenados por
 * `position` — SEMPRE via duas queries simples seguidas de junção em
 * memória (nunca um select aninhado product_options→product_option_values
 * do PostgREST), pela mesma cautela de resolveOwnedOptionValue acima.
 */
export async function getProductOptionsWithValues(
  supabase: SupabaseServerClient,
  tenantId: string,
  productId: string,
): Promise<ProductOptionWithValues[]> {
  const { data: optionRows } = await supabase
    .from("product_options")
    .select("id, name, position")
    .eq("tenant_id", tenantId)
    .eq("product_id", productId);

  const options = ((optionRows ?? []) as { id: string; name: string; position: number }[])
    .slice()
    .sort((a, b) => a.position - b.position);
  if (options.length === 0) return [];

  const { data: valueRows } = await supabase
    .from("product_option_values")
    .select("id, value, position, product_option_id")
    .eq("tenant_id", tenantId)
    .in(
      "product_option_id",
      options.map((o) => o.id),
    );

  const values = (valueRows ?? []) as { id: string; value: string; position: number; product_option_id: string }[];

  return options.map((option) => ({
    id: option.id,
    name: option.name,
    position: option.position,
    values: values
      .filter((v) => v.product_option_id === option.id)
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((v) => ({ id: v.id, value: v.value, position: v.position })),
  }));
}
