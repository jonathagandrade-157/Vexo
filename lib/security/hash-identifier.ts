import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 of a normalized identifier (CPF/CNPJ today; any similar
 * document later) against a server-only secret. Used so the database only
 * ever stores a hash, never the identifier itself (architecture §13,
 * §25.1) — `profiles.cpf_hash` and `trial_eligibility.document_hash`
 * (Etapa 3) both use this.
 *
 * Pure function, no `process.env` access: the caller reads the secret via
 * `getServerEnv().TRIAL_HASH_SECRET`.
 */
export function hashIdentifier(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

/** Strips everything but digits — e.g. "123.456.789-01" -> "12345678901". */
export function normalizeDocument(value: string): string {
  return value.replace(/\D/g, "");
}

/** Hashes a CPF or CNPJ (normalized first, so formatting never matters). */
export function hashDocument(document: string, secret: string): string {
  return hashIdentifier(normalizeDocument(document), secret);
}

/** Constant-time comparison, for when a hash needs to be checked against a stored value outside a plain `=` SQL comparison. */
export function identifierHashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
