import "server-only";

import { cookies } from "next/headers";

import { getCartCookieName } from "./cart-cookie-name";
import { parseCartCredentials, serializeCartCredentials, type CartCredentials } from "./cart-session";

export { getCartCookieName };

const CART_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 dias

/** Só lê — nunca cria. Credenciais inválidas/legadas são tratadas como ausência de carrinho. */
export async function getCartCredentials(storeSlug: string): Promise<CartCredentials | null> {
  const store = await cookies();
  return parseCartCredentials(store.get(getCartCookieName(storeSlug))?.value);
}

/**
 * Id e segredo são sempre gerados no servidor. O segredo aleatório é a
 * prova de posse; o UUID isolado nunca autoriza acesso.
 */
export async function setCartCredentials(storeSlug: string, credentials: CartCredentials): Promise<void> {
  const store = await cookies();
  store.set(getCartCookieName(storeSlug), serializeCartCredentials(credentials), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    // Também funciona nas rotas limpas de domínio personalizado.
    path: "/",
    maxAge: CART_COOKIE_MAX_AGE_SECONDS,
  });
}
