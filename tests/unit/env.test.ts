import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  NEXT_PUBLIC_STOREFRONT_DOMAIN_SUFFIX: "vexo.local",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  TRIAL_HASH_SECRET: "a-trial-hash-secret-thats-long-enough",
  MERCADO_PAGO_CLIENT_ID: "test-mp-client-id",
  MERCADO_PAGO_CLIENT_SECRET: "test-mp-client-secret",
  MERCADO_PAGO_WEBHOOK_SECRET: "test-mp-webhook-secret",
  OAUTH_STATE_SECRET: "a-oauth-state-secret-thats-long-enough",
};

describe("lib/env", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    for (const key of Object.keys(VALID_ENV)) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("parses valid public env vars", async () => {
    Object.assign(process.env, VALID_ENV);
    const { getPublicEnv } = await import("@/lib/env");
    expect(getPublicEnv()).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: VALID_ENV.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: VALID_ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      NEXT_PUBLIC_SITE_URL: VALID_ENV.NEXT_PUBLIC_SITE_URL,
      NEXT_PUBLIC_STOREFRONT_DOMAIN_SUFFIX:
        VALID_ENV.NEXT_PUBLIC_STOREFRONT_DOMAIN_SUFFIX,
    });
  });

  it("throws with a readable message when a public var is missing", async () => {
    Object.assign(process.env, VALID_ENV);
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const { getPublicEnv } = await import("@/lib/env");
    expect(() => getPublicEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("throws when a public var is not a valid URL", async () => {
    Object.assign(process.env, VALID_ENV, {
      NEXT_PUBLIC_SITE_URL: "not-a-url",
    });
    const { getPublicEnv } = await import("@/lib/env");
    expect(() => getPublicEnv()).toThrow();
  });

  it("parses valid server env vars — core only, no Mercado Pago fields", async () => {
    Object.assign(process.env, VALID_ENV);
    const { getServerEnv } = await import("@/lib/env");
    expect(getServerEnv()).toEqual({
      SUPABASE_SERVICE_ROLE_KEY: VALID_ENV.SUPABASE_SERVICE_ROLE_KEY,
      TRIAL_HASH_SECRET: VALID_ENV.TRIAL_HASH_SECRET,
    });
  });

  it("getServerEnv() succeeds even when every Mercado Pago var is missing (production incident regression — auth/signup must never depend on payment credentials)", async () => {
    Object.assign(process.env, VALID_ENV);
    delete process.env.MERCADO_PAGO_CLIENT_ID;
    delete process.env.MERCADO_PAGO_CLIENT_SECRET;
    delete process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    delete process.env.OAUTH_STATE_SECRET;

    const { getServerEnv } = await import("@/lib/env");
    expect(() => getServerEnv()).not.toThrow();
  });

  it("refuses to read server env vars when called from the browser", async () => {
    Object.assign(process.env, VALID_ENV);
    const { getServerEnv } = await import("@/lib/env");

    vi.stubGlobal("window", {});
    try {
      expect(() => getServerEnv()).toThrow(/must never be called from the browser/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("parses valid Mercado Pago env vars", async () => {
    Object.assign(process.env, VALID_ENV);
    const { getMercadoPagoEnv } = await import("@/lib/env");
    expect(getMercadoPagoEnv()).toEqual({
      MERCADO_PAGO_CLIENT_ID: VALID_ENV.MERCADO_PAGO_CLIENT_ID,
      MERCADO_PAGO_CLIENT_SECRET: VALID_ENV.MERCADO_PAGO_CLIENT_SECRET,
      MERCADO_PAGO_WEBHOOK_SECRET: VALID_ENV.MERCADO_PAGO_WEBHOOK_SECRET,
      OAUTH_STATE_SECRET: VALID_ENV.OAUTH_STATE_SECRET,
    });
  });

  it("getMercadoPagoEnv() throws a clear, secret-free error when Mercado Pago vars are missing", async () => {
    Object.assign(process.env, VALID_ENV);
    delete process.env.MERCADO_PAGO_CLIENT_ID;
    delete process.env.MERCADO_PAGO_CLIENT_SECRET;
    delete process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    delete process.env.OAUTH_STATE_SECRET;

    const { getMercadoPagoEnv } = await import("@/lib/env");
    let thrown: unknown;
    try {
      getMercadoPagoEnv();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toMatch(/Mercado Pago/);
    expect(message).toMatch(/não está configurada/);
    // Never leak any configured secret value into the error message.
    for (const value of Object.values(VALID_ENV)) {
      expect(message).not.toContain(value);
    }
  });

  it("refuses to read Mercado Pago env vars when called from the browser", async () => {
    Object.assign(process.env, VALID_ENV);
    const { getMercadoPagoEnv } = await import("@/lib/env");

    vi.stubGlobal("window", {});
    try {
      expect(() => getMercadoPagoEnv()).toThrow(/must never be called from the browser/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("memoizes the parsed value across calls", async () => {
    Object.assign(process.env, VALID_ENV);
    const { getPublicEnv } = await import("@/lib/env");
    const first = getPublicEnv();
    process.env.NEXT_PUBLIC_SITE_URL = "https://changed.example.com";
    const second = getPublicEnv();
    expect(second).toBe(first);
  });
});
