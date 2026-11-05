import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { z } from "zod";

export const PENDING_SIGNUP_COOKIE = "vexo_pending_signup";
export const PENDING_SIGNUP_TTL = 3600;
const context = Buffer.from("vexo:pending-signup:v1");
const pendingSchema = z.object({
  userId: z.string().uuid(), storeName: z.string().min(2).max(120),
  fullName: z.string().min(2).max(120), phone: z.string().min(10).max(32),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.number().int().positive(),
}).strict();
export type EnrollmentInput = Omit<z.infer<typeof pendingSchema>, "expiresAt">;
const key = (secret: string) => createHmac("sha256", secret).update(context).digest();

// Only server-computed document HMACs enter this encrypted, authenticated
// envelope. Passwords, plaintext documents and editable user_metadata do not.
export function sealPendingSignup(input: EnrollmentInput, secret: string, now = Date.now()): string {
  const payload = pendingSchema.parse({ ...input, expiresAt: now + PENDING_SIGNUP_TTL * 1000 });
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), nonce);
  cipher.setAAD(context);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function openPendingSignup(value: string | undefined, userId: string, secret: string, now = Date.now()): EnrollmentInput | null {
  try {
    if (!value || value.length > 3500 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
    const bytes = Buffer.from(value, "base64url");
    if (bytes.length <= 28) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(secret), bytes.subarray(0, 12));
    decipher.setAAD(context); decipher.setAuthTag(bytes.subarray(12, 28));
    const data = pendingSchema.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")));
    if (data.userId !== userId || data.expiresAt <= now || data.expiresAt > now + PENDING_SIGNUP_TTL * 1000) return null;
    const { expiresAt: _expiry, ...input } = data;
    return input;
  } catch { return null; }
}
