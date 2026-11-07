import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Prova de posse da confirmação de pedido (`/loja/[slug]/pedido/[orderId]`).
 *
 * Antes, o `order_id` (UUID) era sozinho a credencial: qualquer pessoa que
 * conhecesse a URL — histórico compartilhado, print, encaminhamento, log —
 * via nome, endereço e itens, e a RPC `get_order_confirmation` aceitava o
 * mesmo par diretamente pela API pública com a chave anon.
 *
 * Formato: `<expiração em segundos, base36>.<HMAC-SHA256 base64url>`. A
 * assinatura cobre versão, finalidade, tenant, pedido e expiração, então:
 *  - trocar a loja (slug → outro tenant) invalida o token;
 *  - trocar o pedido invalida o token;
 *  - alterar a expiração invalida o token;
 *  - token expirado só é reconhecido como "expirado" se a assinatura for
 *    válida (quem não tem a chave nunca distingue expirado de inválido).
 *
 * A chave nunca é a de outro propósito diretamente: `deriveOrderAccessKey`
 * separa o domínio por HMAC com contexto fixo, o mesmo padrão já usado pelo
 * cookie cifrado de cadastro (features/auth/pending-signup.ts).
 */

export const ORDER_ACCESS_QUERY_PARAM = "acesso";
/** 30 dias — cobre o acompanhamento de PIX/entrega sem tornar o link uma credencial permanente. */
export const ORDER_ACCESS_TTL_SECONDS = 30 * 24 * 60 * 60;

const VERSION = "v1";
const PURPOSE = "order-confirmation";
const KEY_CONTEXT = "vexo:order-access-token:v1";
const MAX_TOKEN_LENGTH = 96;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OrderAccessVerification = "valid" | "expired" | "invalid";

export function deriveOrderAccessKey(secret: string): Buffer {
  if (secret.length < 16) throw new Error("Order access secret is too short.");
  return createHmac("sha256", secret).update(KEY_CONTEXT).digest();
}

function signature(key: Buffer, tenantId: string, orderId: string, expiresAt: number): string {
  return createHmac("sha256", key)
    .update(`${VERSION}|${PURPOSE}|${tenantId.toLowerCase()}|${orderId.toLowerCase()}|${expiresAt}`)
    .digest("base64url");
}

export function createOrderAccessToken(input: {
  key: Buffer;
  tenantId: string;
  orderId: string;
  now?: number;
  ttlSeconds?: number;
}): string {
  if (!UUID_PATTERN.test(input.tenantId) || !UUID_PATTERN.test(input.orderId)) {
    throw new Error("Order access token requires UUID identifiers.");
  }
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  const expiresAt = nowSeconds + (input.ttlSeconds ?? ORDER_ACCESS_TTL_SECONDS);
  return `${expiresAt.toString(36)}.${signature(input.key, input.tenantId, input.orderId, expiresAt)}`;
}

/** Nunca lança: qualquer entrada malformada é `invalid`, sem revelar o motivo. */
export function verifyOrderAccessToken(input: {
  key: Buffer;
  tenantId: string;
  orderId: string;
  token: string | null | undefined;
  now?: number;
}): OrderAccessVerification {
  const { token } = input;
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return "invalid";
  if (!UUID_PATTERN.test(input.tenantId) || !UUID_PATTERN.test(input.orderId)) return "invalid";

  const parts = token.split(".");
  if (parts.length !== 2) return "invalid";
  const [expiresPart, receivedSignature] = parts as [string, string];
  if (!/^[0-9a-z]{1,12}$/.test(expiresPart) || !/^[A-Za-z0-9_-]{43}$/.test(receivedSignature)) return "invalid";

  const expiresAt = Number.parseInt(expiresPart, 36);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) return "invalid";
  // Rejeita representações alternativas do mesmo número (ex.: zeros à esquerda).
  if (expiresAt.toString(36) !== expiresPart) return "invalid";

  const expected = Buffer.from(signature(input.key, input.tenantId, input.orderId, expiresAt));
  const received = Buffer.from(receivedSignature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return "invalid";

  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  return nowSeconds >= expiresAt ? "expired" : "valid";
}
