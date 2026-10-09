import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { getCartCredentials } from "./cart-cookie";
import { hashCartToken } from "./cart-session";

export interface OwnedCart {
  id: string;
  ownerTokenHash: string;
  checkoutOrderId: string | null;
}

/**
 * Autoriza um carrinho ativo usando tenant + id + hash do segredo do
 * cookie. O UUID nunca é usado isoladamente como prova de posse.
 */
export async function getOwnedCartForCheckout(storeSlug: string, tenantId: string): Promise<OwnedCart | null> {
  const credentials = await getCartCredentials(storeSlug);
  if (!credentials) return null;

  const ownerTokenHash = hashCartToken(credentials.token);
  const { data } = await createSupabaseServiceRoleClient()
    .from("carts")
    .select("id, checkout_order_id")
    .eq("id", credentials.cartId)
    .eq("tenant_id", tenantId)
    .eq("owner_token_hash", ownerTokenHash)
    .maybeSingle();

  return data ? { id: data.id, ownerTokenHash, checkoutOrderId: data.checkout_order_id } : null;
}

export async function getOwnedActiveCart(storeSlug: string, tenantId: string): Promise<OwnedCart | null> {
  const cart = await getOwnedCartForCheckout(storeSlug, tenantId);
  return cart?.checkoutOrderId === null ? cart : null;
}
