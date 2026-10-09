import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

const COOKIE_VERSION = "v1";
const TOKEN_BYTES = 32;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface CartCredentials {
  cartId: string;
  token: string;
}

export interface NewCartCredentials extends CartCredentials {
  cookieValue: string;
  tokenHash: string;
}

export function hashCartToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function serializeCartCredentials(credentials: CartCredentials): string {
  return `${COOKIE_VERSION}.${credentials.cartId}.${credentials.token}`;
}

export function parseCartCredentials(value: string | undefined): CartCredentials | null {
  if (!value) return null;
  const [version, cartId, token, extra] = value.split(".");
  if (version !== COOKIE_VERSION || extra !== undefined) return null;
  if (!cartId || !UUID_PATTERN.test(cartId) || !token || !TOKEN_PATTERN.test(token)) return null;
  return { cartId: cartId.toLowerCase(), token };
}

export function createCartCredentials(): NewCartCredentials {
  const cartId = randomUUID();
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return {
    cartId,
    token,
    tokenHash: hashCartToken(token),
    cookieValue: serializeCartCredentials({ cartId, token }),
  };
}
