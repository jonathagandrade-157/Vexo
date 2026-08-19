import "server-only";

import { cookies } from "next/headers";

import { getCartCookieName } from "./cart-cookie-name";

export { getCartCookieName };

const CART_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 dias

/** Só lê — nunca cria. Um `cart_id` de cookie nunca é, por si só, autoridade: toda mutação ainda revalida tenant/produto no servidor. */
export async function getCartId(storeSlug: string): Promise<string | null> {
  const store = await cookies();
  return store.get(getCartCookieName(storeSlug))?.value ?? null;
}

/**
 * `cart_id` é sempre gerado no servidor (nunca aceito do cliente) antes
 * de chamar isto — o cookie só guarda um id opaco, um token de posse
 * (como um token de sessão), não uma escolha do cliente.
 */
export async function setCartId(storeSlug: string, cartId: string): Promise<void> {
  const store = await cookies();
  store.set(getCartCookieName(storeSlug), cartId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: `/loja/${storeSlug}`,
    maxAge: CART_COOKIE_MAX_AGE_SECONDS,
  });
}
