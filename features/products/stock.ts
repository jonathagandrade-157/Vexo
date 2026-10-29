import type { SupabaseClient } from "@supabase/supabase-js";

/** Base-product stock is separate from variant stock. PostgREST cannot
 * express the predicate required by the partial unique index in upsert.
 * Update first; insert missing rows, retrying only a concurrent insertion.
 */
export async function saveSimpleProductStock(
  supabase: SupabaseClient,
  tenantId: string,
  productId: string,
  stockQuantity: number | undefined,
  lowStockThreshold: number | undefined,
): Promise<boolean> {
  if (stockQuantity === undefined) {
    const { error } = await supabase.from("product_inventory").delete()
      .eq("product_id", productId).eq("tenant_id", tenantId).is("variant_id", null);
    return !error;
  }
  const payload = { stock_quantity: stockQuantity, low_stock_threshold: lowStockThreshold ?? null };
  const update = () => supabase.from("product_inventory").update(payload, { count: "exact" })
    .eq("product_id", productId).eq("tenant_id", tenantId).is("variant_id", null);
  const updated = await update();
  if (updated.error) return false;
  if (updated.count === 1) return true;
  if (updated.count !== 0) return false;
  const inserted = await supabase.from("product_inventory").insert({
    ...payload, tenant_id: tenantId, product_id: productId, variant_id: null,
  });
  if (!inserted.error) return true;
  if (inserted.error.code !== "23505") return false;
  const retried = await update();
  return !retried.error && retried.count === 1;
}
