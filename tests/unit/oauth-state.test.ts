import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createOAuthState, verifyOAuthState } from "@/lib/security/oauth-state";

const SECRET = "a-test-oauth-state-secret-32bytes";

describe("createOAuthState / verifyOAuthState", () => {
  it("round-trips the tenantId through a valid state", () => {
    const state = createOAuthState("tenant-123", SECRET);
    const verified = verifyOAuthState(state, SECRET);
    expect(verified).toEqual({ tenantId: "tenant-123" });
  });

  it("rejects a state signed with a different secret", () => {
    const state = createOAuthState("tenant-123", SECRET);
    expect(verifyOAuthState(state, "a-completely-different-secret-x")).toBeNull();
  });

  it("rejects a tampered payload (tenant swapped after signing)", () => {
    const state = createOAuthState("tenant-a", SECRET);
    const signature = state.split(".")[1];
    const tamperedPayload = Buffer.from(
      JSON.stringify({ tenantId: "tenant-b", nonce: "x", exp: Date.now() + 60_000 }),
      "utf8",
    ).toString("base64url");
    expect(verifyOAuthState(`${tamperedPayload}.${signature}`, SECRET)).toBeNull();
  });

  it("rejects an expired state", () => {
    // Constrói um state já expirado diretamente (sem esperar 10 minutos de verdade).
    const payload = { tenantId: "tenant-123", nonce: "x", exp: Date.now() - 1000 };
    const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = createHmac("sha256", SECRET).update(payloadB64).digest("base64url");
    expect(verifyOAuthState(`${payloadB64}.${signature}`, SECRET)).toBeNull();
  });

  it("rejects a malformed state (missing signature, garbage input)", () => {
    expect(verifyOAuthState("not-a-valid-state", SECRET)).toBeNull();
    expect(verifyOAuthState("", SECRET)).toBeNull();
    expect(verifyOAuthState("a.b.c", SECRET)).toBeNull();
  });

  it("produces a different state each time (nonce), even for the same tenant", () => {
    const a = createOAuthState("tenant-123", SECRET);
    const b = createOAuthState("tenant-123", SECRET);
    expect(a).not.toBe(b);
  });
});
