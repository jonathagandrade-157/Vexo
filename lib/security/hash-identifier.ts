import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 of a normalized identifier (CPF/CNPJ today; any similar
 * document later) against a server-only secret. Used so the database only
 * ever stores a hash, never the identifier itself (architecture §13,
 * §25.1) — `profiles.cpf_hash` (Etapa 2 migration 0002) and the future
 * `trial_eligibility.document_hash` (architecture §5.5, not built yet)
 * both use this.
 *
 * Pure function, no `process.env` access: the caller reads the secret via
 * `getServerEnv()` once that variable is actually introduced (no feature
 * in this stage calls this yet, so the env var isn't declared until one
 * does — see lib/env.ts).
 */
export function hashIdentifier(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

/** Strips everything but digits — e.g. "123.456.789-01" -> "12345678901". */
export function normalizeCpf(value: string): string {
  return value.replace(/\D/g, "");
}

export function hashCpf(cpf: string, secret: string): string {
  return hashIdentifier(normalizeCpf(cpf), secret);
}

/** Constant-time comparison, for when a hash needs to be checked against a stored value outside a plain `=` SQL comparison. */
export function identifierHashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
