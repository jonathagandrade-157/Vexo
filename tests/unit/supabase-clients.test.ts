import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  NEXT_PUBLIC_STOREFRONT_DOMAIN_SUFFIX: "vexo.local",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  TRIAL_HASH_SECRET: "a-trial-hash-secret-thats-long-enough",
};

describe("lib/supabase clients", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    Object.assign(process.env, VALID_ENV);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.doUnmock("next/headers");
  });

  it("createSupabaseBrowserClient builds a client from public env only", async () => {
    const { createSupabaseBrowserClient } = await import(
      "@/lib/supabase/client"
    );
    const client = createSupabaseBrowserClient();
    expect(client).toBeDefined();
    expect(typeof client.from).toBe("function");
  });

  it("createSupabaseServiceRoleClient builds a client using the service-role key", async () => {
    const { createSupabaseServiceRoleClient } = await import(
      "@/lib/supabase/server"
    );
    const client = createSupabaseServiceRoleClient();
    expect(client).toBeDefined();
    expect(typeof client.from).toBe("function");
  });

  it("createSupabaseServerClient reads the request's cookies via next/headers", async () => {
    vi.doMock("next/headers", () => ({
      cookies: async () => ({
        getAll: () => [{ name: "sb-session", value: "token" }],
        set: vi.fn(),
      }),
    }));

    const { createSupabaseServerClient } = await import(
      "@/lib/supabase/server"
    );
    const client = await createSupabaseServerClient();
    expect(client).toBeDefined();
    expect(typeof client.from).toBe("function");
  });
});
