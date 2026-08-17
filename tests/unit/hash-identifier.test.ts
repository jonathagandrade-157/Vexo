import { describe, expect, it } from "vitest";
import {
  hashCpf,
  hashIdentifier,
  identifierHashesMatch,
  normalizeCpf,
} from "@/lib/security/hash-identifier";

describe("normalizeCpf", () => {
  it("strips punctuation", () => {
    expect(normalizeCpf("123.456.789-01")).toBe("12345678901");
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

describe("hashCpf", () => {
  it("normalizes before hashing, so formatted and raw CPF match", () => {
    expect(hashCpf("123.456.789-01", "secret")).toBe(
      hashCpf("12345678901", "secret"),
    );
  });
});

describe("identifierHashesMatch", () => {
  it("true for equal hashes, false for different ones", () => {
    const h = hashCpf("12345678901", "secret");
    expect(identifierHashesMatch(h, h)).toBe(true);
    expect(identifierHashesMatch(h, hashCpf("10987654321", "secret"))).toBe(
      false,
    );
  });

  it("false for different-length inputs (never throws)", () => {
    expect(identifierHashesMatch("ab", "abcd")).toBe(false);
  });
});
