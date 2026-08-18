import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * `state` assinado do fluxo OAuth de pagamentos (arquitetura §11) —
 * carrega o `tenant_id` (nunca aceito solto do callback/navegador) +
 * nonce + expiração curta, tudo dentro de um blob assinado por HMAC.
 * Sem estado no servidor de propósito: a proteção real contra replay do
 * fluxo inteiro vem do `code` do provedor ser de uso único (garantido
 * pelo próprio Mercado Pago, não por nós) — o que este módulo garante é
 * que o `state` não pode ser forjado nem reaproveitado depois de
 * expirado, e que o tenant nele nunca pode ser trocado no meio do
 * caminho (mesmo padrão de "nunca confiar em tenant_id do cliente" do
 * resto do projeto, aplicado a um valor que atravessa um redirect
 * externo).
 */
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutos

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
