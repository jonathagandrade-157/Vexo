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

describe("lib/supabase clients", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    Object.assign(process.env, VALID_ENV);
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_SECRET_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.doUnmock("next/headers");
    vi.unstubAllGlobals();
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

  it("builds both clients with modern Supabase keys only", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_modern";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_modern";
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const { createSupabaseBrowserClient } = await import("@/lib/supabase/client");
    const { createSupabaseServiceRoleClient } = await import("@/lib/supabase/server");

    expect(typeof createSupabaseBrowserClient().from).toBe("function");
    expect(typeof createSupabaseServiceRoleClient().from).toBe("function");
  });

  it("sends the modern server secret as the API key from a server-only base client", async () => {
    process.env.SUPABASE_SECRET_KEY = "sb_secret_modern";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { createSupabaseServiceRoleClient } = await import("@/lib/supabase/server");
    const result = await createSupabaseServiceRoleClient().from("carts").select("id").limit(1);

    expect(result.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init?.headers).get("apikey")).toBe("sb_secret_modern");
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
