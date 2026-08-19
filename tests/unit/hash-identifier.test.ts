import { describe, expect, it } from "vitest";
import {
  hashDocument,
  hashIdentifier,
  identifierHashesMatch,
  normalizeDocument,
} from "@/lib/security/hash-identifier";

describe("normalizeDocument", () => {
  it("strips punctuation", () => {
    expect(normalizeDocument("123.456.789-01")).toBe("12345678901");
  });
});

describe("hashIdentifier", () => {
  it("is deterministic for the same value and secret", () => {
    expect(hashIdentifier("12345678901", "secret")).toBe(
      hashIdentifier("12345678901", "secret"),
    );
  });

  it("differs when the secret differs", () => {
    expect(hashIdentifier("12345678901", "secret-a")).not.toBe(
      hashIdentifier("12345678901", "secret-b"),
    );
  });

  it("never returns the raw input", () => {
    const hash = hashIdentifier("12345678901", "secret");
    expect(hash).not.toContain("12345678901");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("hashDocument", () => {
  it("normalizes before hashing, so formatted and raw documents match", () => {
    expect(hashDocument("123.456.789-01", "secret")).toBe(
      hashDocument("12345678901", "secret"),
    );
  });

  it("works for CNPJ-length documents too", () => {
    expect(hashDocument("11.222.333/0001-81", "secret")).toBe(
      hashDocument("11222333000181", "secret"),
    );
  });
});

describe("identifierHashesMatch", () => {
  it("true for equal hashes, false for different ones", () => {
    const h = hashDocument("12345678901", "secret");
    expect(identifierHashesMatch(h, h)).toBe(true);
    expect(
      identifierHashesMatch(h, hashDocument("10987654321", "secret")),
    ).toBe(false);
  });

  it("false for different-length inputs (never throws)", () => {
    expect(identifierHashesMatch("ab", "abcd")).toBe(false);
  });
});
