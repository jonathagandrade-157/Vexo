import { expect, it } from "vitest";
import { openPendingSignup, PENDING_SIGNUP_TTL, sealPendingSignup } from "@/features/auth/pending-signup";
const secret = "synthetic-envelope-secret-only-not-production";
const userId = "11111111-1111-4111-8111-111111111111";
const input = { userId, storeName: "Loja sintética", fullName: "Nome sintético", phone: "11999999999", documentHash: "a".repeat(64) };
const now = 1_800_000_000_000;
it("retains only server-trusted enrollment data in an opaque randomized envelope", () => {
  const value = sealPendingSignup(input, secret, now);
  expect(openPendingSignup(value, userId, secret, now)).toEqual(input);
  expect(sealPendingSignup(input, secret, now)).not.toBe(value);
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  for (const plain of [input.fullName, input.phone, input.documentHash]) expect(decoded).not.toContain(plain);
  expect(() => sealPendingSignup({ ...input, document: "11144477735" } as never, secret, now)).toThrow();
});
it("rejects tampering, wrong account, wrong key, expired state and malformed input", () => {
  const value = sealPendingSignup(input, secret, now);
  const bytes = Buffer.from(value, "base64url"); bytes[bytes.length - 1]! ^= 1;
  expect(openPendingSignup(bytes.toString("base64url"), userId, secret, now)).toBeNull();
  expect(openPendingSignup(value, "22222222-2222-4222-8222-222222222222", secret, now)).toBeNull();
  expect(openPendingSignup(value, userId, "wrong-secret", now)).toBeNull();
  expect(openPendingSignup(value, userId, secret, now + PENDING_SIGNUP_TTL * 1000)).toBeNull();
  for (const invalid of [undefined, "", "../../invalid", "a".repeat(4000)]) expect(openPendingSignup(invalid, userId, secret, now)).toBeNull();
});
