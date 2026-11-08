/** Shared with the real PostgREST regression so its embeds cannot drift. */
export const CART_ITEMS_SELECT =
  "id, quantity, variant_id, product:products(id, name, slug, price, promotional_price, main_image, status), variant:product_variants(id, sku, price, promotional_price, is_active)";
