import { describe, expect, it } from "vitest";

import {
  createCartCredentials,
  hashCartToken,
  parseCartCredentials,
  serializeCartCredentials,
} from "@/features/cart/cart-session";

describe("cart ownership credentials", () => {
  it("creates an opaque 256-bit token and stores only its SHA-256 hash", () => {
    const first = createCartCredentials();
    const second = createCartCredentials();

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.tokenHash).toBe(hashCartToken(first.token));
    expect(first.token).not.toBe(first.tokenHash);
    expect(first.cartId).not.toBe(second.cartId);
    expect(first.token).not.toBe(second.token);
  });

  it("round-trips the versioned cookie but rejects legacy ids and tampering", () => {
    const credentials = createCartCredentials();
    const serialized = serializeCartCredentials(credentials);

    expect(parseCartCredentials(serialized)).toEqual({
      cartId: credentials.cartId,
      token: credentials.token,
    });
    expect(parseCartCredentials(credentials.cartId)).toBeNull();
    expect(parseCartCredentials(`${serialized}x`)).toBeNull();
    expect(parseCartCredentials(`v2.${credentials.cartId}.${credentials.token}`)).toBeNull();
    expect(parseCartCredentials(undefined)).toBeNull();
  });
});
