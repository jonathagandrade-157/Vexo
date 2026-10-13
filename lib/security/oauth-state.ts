import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * `state` assinado do fluxo OAuth de pagamentos (arquitetura §11) —
 * carrega o `tenant_id` (nunca aceito solto do callback/navegador) +
 * nonce + expiração curta, tudo dentro de um blob assinado por HMAC.
 * O `state` não pode ser forjado nem reaproveitado depois de expirado, e
 * o tenant nele nunca pode ser trocado no meio do caminho. A tentativa
 * também é ligada ao navegador por um cookie HttpOnly consumível e ao
 * code exchange por PKCE (abaixo), cobrindo replay no lado da VEXO além
 * do `code` de uso único do próprio provedor.
 */
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutos
export const MERCADO_PAGO_OAUTH_COOKIE = "vexo_mp_oauth_attempt";
export const OAUTH_ATTEMPT_TTL_SECONDS = STATE_TTL_MS / 1000;

interface OAuthStatePayload {
  tenantId: string;
  nonce: string;
  exp: number;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createOAuthState(tenantId: string, secret: string): string {
  const payload: OAuthStatePayload = { tenantId, nonce: randomUUID(), exp: Date.now() + STATE_TTL_MS };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/** Retorna `null` para qualquer state malformado, com assinatura inválida, ou expirado — nunca lança para não vazar detalhe do motivo da rejeição. */
export function verifyOAuthState(state: string, secret: string): { tenantId: string } | null {
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts as [string, string];

  const expectedSignature = sign(payloadB64, secret);
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64)) as Partial<OAuthStatePayload>;
    if (typeof payload.tenantId !== "string" || typeof payload.exp !== "number") return null;
    if (Date.now() > payload.exp) return null;
    return { tenantId: payload.tenantId };
  } catch {
    return null;
  }
}

/**
 * Liga uma tentativa OAuth ao navegador que a iniciou e gera PKCE S256.
 * O cookie contém somente um HMAC do state e o verifier aleatório; é
 * HttpOnly e consumido pelo callback antes da troca do code.
 */
export function createOAuthAttempt(state: string, secret: string): {
  cookieValue: string;
  codeChallenge: string;
} {
  const codeVerifier = randomBytes(32).toString("base64url");
  const attemptBinding = createHmac("sha256", secret)
    .update(`oauth-attempt:${state}:${codeVerifier}`)
    .digest("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { cookieValue: `${attemptBinding}.${codeVerifier}`, codeChallenge };
}

/**
 * Valida o vínculo com o navegador e devolve o verifier PKCE. Um valor
 * ausente, alterado ou fora do formato falha fechado sem lançar.
 */
export function verifyOAuthAttempt(state: string, cookieValue: string | undefined, secret: string): string | null {
  if (!cookieValue) return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return null;
  const [receivedBinding, codeVerifier] = parts as [string, string];
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeVerifier)) return null;
  const expectedBinding = createHmac("sha256", secret)
    .update(`oauth-attempt:${state}:${codeVerifier}`)
    .digest("base64url");
  return safeEqual(receivedBinding, expectedBinding) ? codeVerifier : null;
}
