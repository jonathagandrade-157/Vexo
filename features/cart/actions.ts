"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

import { createSupabasePublicClient } from "@/lib/supabase/server";
import { resolveStorefrontTenant } from "@/features/storefront/resolve-tenant";
import { getCartId, setCartId } from "./cart-cookie";
import { addToCartSchema, type CartActionState, updateQuantitySchema } from "./schema";

/** Sempre reresolve o tenant pelo slug (nunca aceita um tenant_id de fora) — arquitetura Etapa 9 §7. */
async function resolveReadyTenant(storeSlug: string) {
  const resolution = await resolveStorefrontTenant(storeSlug);
  if (resolution.status !== "ready") return null;
  return resolution.tenant;
}

function revalidateCartViews(storeSlug: string, productSlug?: string) {
  revalidatePath(`/loja/${storeSlug}`);
  revalidatePath(`/loja/${storeSlug}/carrinho`);
  if (productSlug) revalidatePath(`/loja/${storeSlug}/produto/${productSlug}`);
}

/**
 * Garante um carrinho para este tenant: reaproveita o cookie existente se
 * ainda apontar para um carrinho válido deste tenant, senão cria um novo
 * (id gerado no servidor, nunca aceito do cliente) e grava o cookie.
 */
async function ensureCart(storeSlug: string, tenantId: string): Promise<string> {
  const supabase = createSupabasePublicClient();
  const existingId = await getCartId(storeSlug);

  if (existingId) {
    const { data } = await supabase.from("carts").select("id").eq("id", existingId).eq("tenant_id", tenantId).maybeSingle();
    if (data) return data.id;
  }

  const newId = randomUUID();
  const { error } = await supabase.from("carts").insert({ id: newId, tenant_id: tenantId });
  if (error) throw new Error("Não foi possível criar o carrinho.");
  await setCartId(storeSlug, newId);
  return newId;
}

export async function addToCartAction(
  storeSlug: string,
  _prevState: CartActionState,
  formData: FormData,
): Promise<CartActionState> {
  const parsed = addToCartSchema.safeParse({
    productId: formData.get("productId"),
    quantity: formData.get("quantity"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Quantidade inválida." };
  }

  const tenant = await resolveReadyTenant(storeSlug);
  if (!tenant) return { status: "error", message: "Loja não encontrada." };

  const supabase = createSupabasePublicClient();
  // Nunca confia no productId isoladamente: revalida que existe, pertence
  // a este tenant e está ativo — a mesma projeção pública já usada pelo
  // resto do storefront (RLS pública já filtra status='active').
  const { data: product } = await supabase
    .from("products")
    .select("id, slug")
    .eq("id", parsed.data.productId)
    .eq("tenant_id", tenant.id)
    .maybeSingle();
  if (!product) {
    return { status: "error", message: "Este produto não está mais disponível." };
  }

  let cartId: string;
  try {
    cartId = await ensureCart(storeSlug, tenant.id);
  } catch {
    return { status: "error", message: "Não foi possível abrir o carrinho. Tente novamente." };
  }

  const { error } = await supabase.rpc("add_to_cart", {
    p_tenant_id: tenant.id,
    p_cart_id: cartId,
    p_product_id: product.id,
    p_quantity: parsed.data.quantity,
  });
  if (error) {
    return { status: "error", message: "Não foi possível adicionar ao carrinho. Tente novamente." };
  }

  revalidateCartViews(storeSlug, product.slug);
  return { status: "success", message: "Adicionado ao carrinho." };
}

export async function updateCartItemQuantityAction(
  storeSlug: string,
  cartItemId: string,
  quantity: number,
): Promise<CartActionState> {
  const parsed = updateQuantitySchema.safeParse({ cartItemId, quantity });
  if (!parsed.success) return { status: "error", message: "Quantidade inválida." };

  const tenant = await resolveReadyTenant(storeSlug);
  if (!tenant) return { status: "error", message: "Loja não encontrada." };

  const cartId = await getCartId(storeSlug);
  if (!cartId) return { status: "error", message: "Carrinho não encontrado." };

  const supabase = createSupabasePublicClient();

  if (parsed.data.quantity < 1) {
    const { error } = await supabase
      .from("cart_items")
      .delete()
      .eq("id", parsed.data.cartItemId)
      .eq("cart_id", cartId)
      .eq("tenant_id", tenant.id);
    if (error) return { status: "error", message: "Não foi possível remover o item." };
    revalidateCartViews(storeSlug);
    return { status: "success" };
  }

  const { error, count } = await supabase
    .from("cart_items")
    .update({ quantity: parsed.data.quantity }, { count: "exact" })
    .eq("id", parsed.data.cartItemId)
    .eq("cart_id", cartId)
    .eq("tenant_id", tenant.id);
  if (error) return { status: "error", message: "Não foi possível atualizar a quantidade." };
  if (!count) return { status: "error", message: "Item não encontrado no carrinho." };

  revalidateCartViews(storeSlug);
  return { status: "success" };
}

export async function removeCartItemAction(storeSlug: string, cartItemId: string): Promise<CartActionState> {
  const tenant = await resolveReadyTenant(storeSlug);
  if (!tenant) return { status: "error", message: "Loja não encontrada." };

  const cartId = await getCartId(storeSlug);
  if (!cartId) return { status: "error", message: "Carrinho não encontrado." };

  const supabase = createSupabasePublicClient();
  const { error, count } = await supabase
    .from("cart_items")
    .delete({ count: "exact" })
    .eq("id", cartItemId)
    .eq("cart_id", cartId)
    .eq("tenant_id", tenant.id);
  if (error) return { status: "error", message: "Não foi possível remover o item." };
  if (!count) return { status: "error", message: "Item não encontrado no carrinho." };

  revalidateCartViews(storeSlug);
  return { status: "success" };
}

export async function clearCartAction(storeSlug: string): Promise<CartActionState> {
  const tenant = await resolveReadyTenant(storeSlug);
  if (!tenant) return { status: "error", message: "Loja não encontrada." };

  const cartId = await getCartId(storeSlug);
  if (!cartId) return { status: "success" };

  const supabase = createSupabasePublicClient();
  const { error } = await supabase.from("cart_items").delete().eq("cart_id", cartId).eq("tenant_id", tenant.id);
  if (error) return { status: "error", message: "Não foi possível limpar o carrinho." };

  revalidateCartViews(storeSlug);
  return { status: "success" };
}
