import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/features/onboarding/resolve-tenant", () => ({ resolveActiveTenantForUser: vi.fn() }));
vi.mock("@/lib/env", () => ({
  getMercadoPagoEnv: vi.fn(),
  getPublicEnv: vi.fn(() => ({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000" })),
}));
vi.mock("@/lib/payments/registry", () => ({ getGateway: vi.fn() }));
vi.mock("@/lib/payments/vault", () => ({ storePaymentCredentials: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

import { cookies } from "next/headers";
import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { getMercadoPagoEnv } from "@/lib/env";
import { getGateway } from "@/lib/payments/registry";
import { storePaymentCredentials } from "@/lib/payments/vault";
import {
  createOAuthAttempt,
  createOAuthState,
  MERCADO_PAGO_OAUTH_COOKIE,
  verifyOAuthAttempt,
} from "@/lib/security/oauth-state";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { GET } from "@/app/api/oauth/mercadopago/callback/route";

const SECRET = "a-test-oauth-state-secret-at-least-32-bytes";
const TENANT_ID = "11111111-1111-1111-1111-111111111111";

function request(code: string, state: string): NextRequest {
  const url = new URL("http://localhost:3000/api/oauth/mercadopago/callback");
  url.searchParams.set("code", code);
  url.searchParams.set("state", state);
  return new NextRequest(url);
}

function errorCode(response: Response): string | null {
  return new URL(response.headers.get("location")!).searchParams.get("error");
}

function fakeSupabase(options: { allowed?: boolean; upsertError?: unknown } = {}) {
  const upsert = vi.fn().mockResolvedValue({ error: options.upsertError ?? null });
  return {
    rpc: vi.fn().mockResolvedValue({ data: options.allowed ?? true }),
    from: vi.fn(() => ({ upsert })),
    upsert,
  };
}

function installCookie(value: string | undefined) {
  let current = value;
  const cookieStore = {
    get: vi.fn((name: string) => (name === MERCADO_PAGO_OAUTH_COOKIE && current ? { value: current } : undefined)),
    delete: vi.fn((name: string) => {
      if (name === MERCADO_PAGO_OAUTH_COOKIE) current = undefined;
    }),
  };
  vi.mocked(cookies).mockResolvedValue(cookieStore as never);
  return cookieStore;
}

describe("GET /api/oauth/mercadopago/callback", () => {
  beforeEach(() => {
    vi.mocked(getMercadoPagoEnv).mockReturnValue({
      MERCADO_PAGO_CLIENT_ID: "test-client-id",
      MERCADO_PAGO_CLIENT_SECRET: "test-client-secret",
      MERCADO_PAGO_WEBHOOK_SECRET: "test-webhook-secret",
      MERCADO_PAGO_TEST_MODE: true,
      OAUTH_STATE_SECRET: SECRET,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejeita tentativa sem cookie, alterada ou vinculada a outro state antes de resolver a sessão", async () => {
    for (const mode of ["missing", "tampered", "wrong-state"] as const) {
      const state = createOAuthState(TENANT_ID, SECRET);
      const attempt = createOAuthAttempt(mode === "wrong-state" ? createOAuthState(TENANT_ID, SECRET) : state, SECRET);
      const cookieValue = mode === "missing" ? undefined : mode === "tampered" ? `${attempt.cookieValue}x` : attempt.cookieValue;
      installCookie(cookieValue);

      const response = await GET(request("auth-code", state));

      expect(errorCode(response)).toBe("invalid_state");
    }
    expect(resolveActiveTenantForUser).not.toHaveBeenCalled();
    expect(getGateway).not.toHaveBeenCalled();
  });

  it("rejeita tenant diferente e não troca o code", async () => {
    const state = createOAuthState(TENANT_ID, SECRET);
    installCookie(createOAuthAttempt(state, SECRET).cookieValue);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(fakeSupabase() as never);
    vi.mocked(resolveActiveTenantForUser).mockResolvedValue({
      tenant: { id: "22222222-2222-2222-2222-222222222222" } as never,
      roleKey: "OWNER",
    });

    const response = await GET(request("auth-code", state));

    expect(errorCode(response)).toBe("session_mismatch");
    expect(getGateway).not.toHaveBeenCalled();
  });

  it("consome a tentativa uma única vez, envia o verifier PKCE e persiste somente metadados seguros", async () => {
    const state = createOAuthState(TENANT_ID, SECRET);
    const attempt = createOAuthAttempt(state, SECRET);
    const verifier = verifyOAuthAttempt(state, attempt.cookieValue, SECRET)!;
    const cookieStore = installCookie(attempt.cookieValue);
    const supabase = fakeSupabase();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(resolveActiveTenantForUser).mockResolvedValue({ tenant: { id: TENANT_ID } as never, roleKey: "OWNER" });
    const exchangeCodeForTokens = vi.fn().mockResolvedValue({
      accessToken: "secret-access-token",
      refreshToken: "secret-refresh-token",
      providerAccountId: "seller-123",
      liveMode: false,
      expiresAt: null,
    });
    vi.mocked(getGateway).mockReturnValue({ exchangeCodeForTokens } as never);
    vi.mocked(storePaymentCredentials).mockResolvedValue(undefined);

    const first = await GET(request("auth-code", state));
    const replay = await GET(request("auth-code", state));

    expect(new URL(first.headers.get("location")!).searchParams.get("connected")).toBe("1");
    expect(errorCode(replay)).toBe("invalid_state");
    expect(cookieStore.delete).toHaveBeenCalledWith(MERCADO_PAGO_OAUTH_COOKIE);
    expect(exchangeCodeForTokens).toHaveBeenCalledTimes(1);
    expect(exchangeCodeForTokens).toHaveBeenCalledWith(
      "auth-code",
      "http://localhost:3000/api/oauth/mercadopago/callback",
      verifier,
    );
    expect(storePaymentCredentials).toHaveBeenCalledWith(
      TENANT_ID,
      "mercadopago",
      expect.objectContaining({ accessToken: "secret-access-token" }),
    );
    expect(supabase.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: TENANT_ID,
        provider: "mercadopago",
        connected_account_id: "seller-123",
        live_mode: false,
      }),
      { onConflict: "tenant_id,provider" },
    );
    expect(JSON.stringify(supabase.upsert.mock.calls)).not.toMatch(/secret-(access|refresh)-token/);
  });
});
