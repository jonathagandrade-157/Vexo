import { describe, expect, it } from "vitest";
import {
  computeDomainChallengeExpiry,
  createDomainChallenge,
  DOMAIN_CHALLENGE_TTL_MS,
  DOMAIN_VERIFICATION_METHOD,
  domainChallengeHashMatches,
  generateDomainChallenge,
  hashDomainChallenge,
  isDomainChallengeExpired,
} from "@/lib/security/domain-challenge";

describe("generateDomainChallenge", () => {
  it("produces at least 128 bits (16 bytes) of entropy, hex-encoded", () => {
    const challenge = generateDomainChallenge();
    expect(challenge).toMatch(/^[0-9a-f]+$/);
    expect(Buffer.from(challenge, "hex").length).toBeGreaterThanOrEqual(16);
  });

  it("produces a different value on each call", () => {
    const a = generateDomainChallenge();
    const b = generateDomainChallenge();
    expect(a).not.toBe(b);
  });
});

describe("hashDomainChallenge", () => {
  it("never returns the raw token", () => {
    const token = generateDomainChallenge();
    const hash = hashDomainChallenge(token);
    expect(hash).not.toBe(token);
    expect(hash).not.toContain(token);
  });

  it("produces the expected SHA-256 hex format (64 chars)", () => {
    const hash = hashDomainChallenge(generateDomainChallenge());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", () => {
    const token = generateDomainChallenge();
    expect(hashDomainChallenge(token)).toBe(hashDomainChallenge(token));
  });
});

describe("domainChallengeHashMatches", () => {
  it("returns true for equal hashes", () => {
    const token = generateDomainChallenge();
    const hash = hashDomainChallenge(token);
    expect(domainChallengeHashMatches(hash, hash)).toBe(true);
  });

  it("returns false for different hashes", () => {
    const hashA = hashDomainChallenge(generateDomainChallenge());
    const hashB = hashDomainChallenge(generateDomainChallenge());
    expect(domainChallengeHashMatches(hashA, hashB)).toBe(false);
  });

  it("returns false (never throws) for different-length inputs", () => {
    expect(domainChallengeHashMatches("ab", "abcd")).toBe(false);
  });
});

describe("computeDomainChallengeExpiry / isDomainChallengeExpired", () => {
  it("expiry is exactly 72h after the start time", () => {
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = computeDomainChallengeExpiry(startedAt);
    expect(expiresAt.getTime() - startedAt.getTime()).toBe(DOMAIN_CHALLENGE_TTL_MS);
    expect(DOMAIN_CHALLENGE_TTL_MS).toBe(72 * 60 * 60 * 1000);
  });

  it("recognizes an expired challenge (now after expiry)", () => {
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = computeDomainChallengeExpiry(startedAt);
    const justAfter = new Date(expiresAt.getTime() + 1);
    expect(isDomainChallengeExpired(expiresAt, justAfter)).toBe(true);
  });

  it("recognizes a challenge still within its window (now before expiry)", () => {
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = computeDomainChallengeExpiry(startedAt);
    const justBefore = new Date(expiresAt.getTime() - 1);
    expect(isDomainChallengeExpired(expiresAt, justBefore)).toBe(false);
  });
});

describe("createDomainChallenge", () => {
  it("bundles method/hash/started/expires consistently", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const { token, record } = createDomainChallenge(now);
    expect(record.verificationMethod).toBe("dns_txt");
    expect(record.verificationMethod).toBe(DOMAIN_VERIFICATION_METHOD);
    expect(record.verificationTokenHash).toBe(hashDomainChallenge(token));
    expect(record.verificationStartedAt).toBe(now);
    expect(record.verificationExpiresAt.getTime()).toBe(now.getTime() + DOMAIN_CHALLENGE_TTL_MS);
  });

  it("rotation: a new challenge never matches (and so never validates against) the previous one's hash", () => {
    const first = createDomainChallenge(new Date("2026-01-01T00:00:00.000Z"));
    const second = createDomainChallenge(new Date("2026-01-02T00:00:00.000Z"));

    // Tokens/hashes/timestamps are all different — a full replacement, never a merge.
    expect(second.token).not.toBe(first.token);
    expect(second.record.verificationTokenHash).not.toBe(first.record.verificationTokenHash);
    expect(second.record.verificationStartedAt).not.toBe(first.record.verificationStartedAt);
    expect(second.record.verificationExpiresAt).not.toBe(first.record.verificationExpiresAt);

    // The old token, once rotated away, no longer matches the new stored hash —
    // i.e. no previous challenge remains valid after a rotation.
    expect(domainChallengeHashMatches(hashDomainChallenge(first.token), second.record.verificationTokenHash)).toBe(false);
    // The current token still matches its own current hash.
    expect(domainChallengeHashMatches(hashDomainChallenge(second.token), second.record.verificationTokenHash)).toBe(true);
  });
});
