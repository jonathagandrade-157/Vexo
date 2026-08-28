import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * D3.2-B — testa o Route Handler do callback OAuth do Melhor Envio
 * (mesmo padrão de tests/unit/cep-autofill-route.test.ts: mocka as peças
 * já testadas isoladamente — createOAuthState/verifyOAuthState em
 * tests/unit/oauth-state.test.ts, o gateway em
 * tests/unit/melhorenvio-gateway.test.ts — e foca só no que ESTE arquivo
 * faz por conta própria: a ordem de validação, o que é gravado, e o que
 * NUNCA aparece na resposta). `verifyOAuthState`/`createOAuthState` não
 * são mockados: usa a implementação real para gerar states válidos, o
 * que também prova que o callback está de fato chamando a versão real
 * (não uma reimplementação paralela), como o prompt exige.
 */
vi.mock("@/features/onboarding/resolve-tenant", () => ({ resolveActiveTenantForUser: vi.fn() }));
vi.mock("@/lib/env", () => ({
  getMelhorEnvioEnv: vi.fn(),
  getPublicEnv: vi.fn(() => ({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000" })),
}));
vi.mock("@/lib/shipping-connections/registry", () => ({ getShippingConnectionGateway: vi.fn() }));
vi.mock("@/lib/shipping-connections/vault", () => ({ storeShippingCredentials: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { getMelhorEnvioEnv } from "@/lib/env";
import { createOAuthState } from "@/lib/security/oauth-state";
import { getShippingConnectionGateway } from "@/lib/shipping-connections/registry";
import { storeShippingCredentials } from "@/lib/shipping-connections/vault";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { GET } from "@/app/api/oauth/melhorenvio/callback/route";

const SECRET = "a-test-oauth-state-secret-32bytes";
const TENANT_ID = "11111111-1111-1111-1111-111111111111";

function request(params: Record<string, string>): NextRequest {
  const url = new URL("http://localhost:3000/api/oauth/melhorenvio/callback");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new NextRequest(url);
}

function errorCode(response: Response): string | null {
  return new URL(response.headers.get("location")!).searchParams.get("me_error");
}

interface FakeSupabase {
  rpc: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
}

function fakeSupabase(options: { allowed?: boolean; upsertError?: unknown } = {}): FakeSupabase {
  const upsert = vi.fn().mockResolvedValue({ error: options.upsertError ?? null });
  return {
    rpc: vi.fn().mockResolvedValue({ data: options.allowed ?? true }),
    from: vi.fn(() => ({ upsert })),
  };
}

describe("GET /api/oauth/melhorenvio/callback (D3.2-B)", () => {
  afterEach(() => {
    vi.mocked(resolveActiveTenantForUser).mockReset();
    vi.mocked(getMelhorEnvioEnv).mockReset();
    vi.mocked(getShippingConnectionGateway).mockReset();
    vi.mocked(storeShippingCredentials).mockReset();
    vi.mocked(createSupabaseServerClient).mockReset();
  });

  it("sem code: redireciona com me_error=oauth_denied, nunca prossegue", async () => {
    const response = await GET(request({ state: "whatever" }));
    expect(errorCode(response)).toBe("oauth_denied");
    expect(resolveActiveTenantForUser).not.toHaveBeenCalled();
  });

  it("sem state: redireciona com me_error=oauth_denied", async () => {
    const response = await GET(request({ code: "abc" }));
    expect(errorCode(response)).toBe("oauth_denied");
  });

  it("provedor retornou error=: redireciona com me_error=oauth_denied mesmo com code/state presentes", async () => {
    const response = await GET(request({ code: "abc", state: "xyz", error: "access_denied" }));
    expect(errorCode(response)).toBe("oauth_denied");
  });

  it("state inválido (assinatura errada): redireciona com me_error=invalid_state, nunca chega a resolver sessão", async () => {
    vi.mocked(getMelhorEnvioEnv).mockReturnValue({
      MELHOR_ENVIO_CLIENT_ID: "id",
      MELHOR_ENVIO_CLIENT_SECRET: "secret",
      MELHOR_ENVIO_SANDBOX: true,
      OAUTH_STATE_SECRET: SECRET,
    });

    const response = await GET(request({ code: "abc", state: "garbage.garbage" }));
    expect(errorCode(response)).toBe("invalid_state");
    expect(resolveActiveTenantForUser).not.toHaveBeenCalled();
  });

  it("state expirado: redireciona com me_error=invalid_state", async () => {
    vi.mocked(getMelhorEnvioEnv).mockReturnValue({
      MELHOR_ENVIO_CLIENT_ID: "id",
      MELHOR_ENVIO_CLIENT_SECRET: "secret",
      MELHOR_ENVIO_SANDBOX: true,
      OAUTH_STATE_SECRET: SECRET,
    });
    // State válido gerado com um secret diferente do configurado é o
    // equivalente estrutural a um state expirado/forjado para este teste
    // de nível de rota (o TTL em si já é coberto exaustivamente por
    // tests/unit/oauth-state.test.ts) — o que importa aqui é que o
    // callback rejeita e nunca prossegue.
    const state = createOAuthState(TENANT_ID, "a-completely-different-secret-x");

    const response = await GET(request({ code: "abc", state }));
    expect(errorCode(response)).toBe("invalid_state");
  });

  it("sessão inválida (nenhuma membership resolvida): redireciona com me_error=session_mismatch", async () => {
    vi.mocked(getMelhorEnvioEnv).mockReturnValue({
      MELHOR_ENVIO_CLIENT_ID: "id",
      MELHOR_ENVIO_CLIENT_SECRET: "secret",
      MELHOR_ENVIO_SANDBOX: true,
      OAUTH_STATE_SECRET: SECRET,
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(fakeSupabase() as never);
    vi.mocked(resolveActiveTenantForUser).mockResolvedValue(null);

    const state = createOAuthState(TENANT_ID, SECRET);
    const response = await GET(request({ code: "abc", state }));
    expect(errorCode(response)).toBe("session_mismatch");
  });

  it("sessão de um tenant diferente do embutido no state (tenant hopping): redireciona com me_error=session_mismatch, nunca confia no tenant_id do state sozinho", async () => {
    vi.mocked(getMelhorEnvioEnv).mockReturnValue({
      MELHOR_ENVIO_CLIENT_ID: "id",
      MELHOR_ENVIO_CLIENT_SECRET: "secret",
      MELHOR_ENVIO_SANDBOX: true,
      OAUTH_STATE_SECRET: SECRET,
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(fakeSupabase() as never);
    vi.mocked(resolveActiveTenantForUser).mockResolvedValue({
      tenant: { id: "22222222-2222-2222-2222-222222222222" } as never,
      roleKey: "OWNER",
    });

    const state = createOAuthState(TENANT_ID, SECRET);
    const response = await GET(request({ code: "abc", state }));
    expect(errorCode(response)).toBe("session_mismatch");
  });

  it("usuário sem shipping_provider.manage: redireciona com me_error=session_mismatch, nunca troca o code", async () => {
    vi.mocked(getMelhorEnvioEnv).mockReturnValue({
      MELHOR_ENVIO_CLIENT_ID: "id",
      MELHOR_ENVIO_CLIENT_SECRET: "secret",
      MELHOR_ENVIO_SANDBOX: true,
      OAUTH_STATE_SECRET: SECRET,
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(fakeSupabase({ allowed: false }) as never);
    vi.mocked(resolveActiveTenantForUser).mockResolvedValue({ tenant: { id: TENANT_ID } as never, roleKey: "MANAGER" });

    const state = createOAuthState(TENANT_ID, SECRET);
    const response = await GET(request({ code: "abc", state }));
    expect(errorCode(response)).toBe("session_mismatch");
    expect(getShippingConnectionGateway).not.toHaveBeenCalled();
  });

  it("falha na troca do code por tokens: redireciona com me_error=exchange_failed, sem vazar o motivo", async () => {
    vi.mocked(getMelhorEnvioEnv).mockReturnValue({
      MELHOR_ENVIO_CLIENT_ID: "id",
      MELHOR_ENVIO_CLIENT_SECRET: "super-secret-value",
      MELHOR_ENVIO_SANDBOX: true,
      OAUTH_STATE_SECRET: SECRET,
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(fakeSupabase() as never);
    vi.mocked(resolveActiveTenantForUser).mockResolvedValue({ tenant: { id: TENANT_ID } as never, roleKey: "OWNER" });
    vi.mocked(getShippingConnectionGateway).mockReturnValue({
      provider: "melhor_envio",
      getAuthorizeUrl: vi.fn(),
      refreshAccessToken: vi.fn(),
      exchangeCodeForTokens: vi.fn().mockRejectedValue(new Error("melhorenvio: token exchange failed (400)")),
    });

    const state = createOAuthState(TENANT_ID, SECRET);
    const response = await GET(request({ code: "abc", state }));
    expect(errorCode(response)).toBe("exchange_failed");
    expect(response.headers.get("location")).not.toContain("super-secret-value");
  });

  it("falha ao salvar no vault: redireciona com me_error=vault_failed, nunca grava metadado de conexão", async () => {
    vi.mocked(getMelhorEnvioEnv).mockReturnValue({
      MELHOR_ENVIO_CLIENT_ID: "id",
      MELHOR_ENVIO_CLIENT_SECRET: "secret",
      MELHOR_ENVIO_SANDBOX: true,
      OAUTH_STATE_SECRET: SECRET,
    });
    const supabase = fakeSupabase();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(resolveActiveTenantForUser).mockResolvedValue({ tenant: { id: TENANT_ID } as never, roleKey: "OWNER" });
    vi.mocked(getShippingConnectionGateway).mockReturnValue({
      provider: "melhor_envio",
      getAuthorizeUrl: vi.fn(),
      refreshAccessToken: vi.fn(),
      exchangeCodeForTokens: vi.fn().mockResolvedValue({ accessToken: "at", refreshToken: "rt", expiresAt: null, refreshExpiresAt: null }),
    });
    vi.mocked(storeShippingCredentials).mockRejectedValue(new Error("vault down"));

    const state = createOAuthState(TENANT_ID, SECRET);
    const response = await GET(request({ code: "abc", state }));
    expect(errorCode(response)).toBe("vault_failed");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("falha ao gravar store_shipping_providers: redireciona com me_error=connection_failed", async () => {
    vi.mocked(getMelhorEnvioEnv).mockReturnValue({
      MELHOR_ENVIO_CLIENT_ID: "id",
      MELHOR_ENVIO_CLIENT_SECRET: "secret",
      MELHOR_ENVIO_SANDBOX: true,
      OAUTH_STATE_SECRET: SECRET,
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(fakeSupabase({ upsertError: { message: "db down" } }) as never);
    vi.mocked(resolveActiveTenantForUser).mockResolvedValue({ tenant: { id: TENANT_ID } as never, roleKey: "OWNER" });
    vi.mocked(getShippingConnectionGateway).mockReturnValue({
      provider: "melhor_envio",
      getAuthorizeUrl: vi.fn(),
      refreshAccessToken: vi.fn(),
      exchangeCodeForTokens: vi.fn().mockResolvedValue({ accessToken: "at", refreshToken: "rt", expiresAt: null, refreshExpiresAt: null }),
    });
    vi.mocked(storeShippingCredentials).mockResolvedValue(undefined);

    const state = createOAuthState(TENANT_ID, SECRET);
    const response = await GET(request({ code: "abc", state }));
    expect(errorCode(response)).toBe("connection_failed");
  });

  it("caminho feliz: conecta, redireciona com me_connected=1, e nem o redirect nem o upsert do metadado carregam access_token/refresh_token/client_secret", async () => {
    vi.mocked(getMelhorEnvioEnv).mockReturnValue({
      MELHOR_ENVIO_CLIENT_ID: "id",
      MELHOR_ENVIO_CLIENT_SECRET: "top-secret-client-secret",
      MELHOR_ENVIO_SANDBOX: true,
      OAUTH_STATE_SECRET: SECRET,
    });
    const supabase = fakeSupabase();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(resolveActiveTenantForUser).mockResolvedValue({ tenant: { id: TENANT_ID } as never, roleKey: "OWNER" });
    vi.mocked(getShippingConnectionGateway).mockReturnValue({
      provider: "melhor_envio",
      getAuthorizeUrl: vi.fn(),
      refreshAccessToken: vi.fn(),
      exchangeCodeForTokens: vi.fn().mockResolvedValue({
        accessToken: "very-secret-access-token",
        refreshToken: "very-secret-refresh-token",
        expiresAt: new Date("2026-09-27T00:00:00Z"),
        refreshExpiresAt: new Date("2026-10-12T00:00:00Z"),
      }),
    });
    vi.mocked(storeShippingCredentials).mockResolvedValue(undefined);

    const state = createOAuthState(TENANT_ID, SECRET);
    const response = await GET(request({ code: "abc", state }));

    expect(response.headers.get("location")).toContain("me_connected=1");
    expect(response.headers.get("location")).not.toMatch(/secret|token/i);

    expect(storeShippingCredentials).toHaveBeenCalledWith(TENANT_ID, "melhor_envio", {
      accessToken: "very-secret-access-token",
      refreshToken: "very-secret-refresh-token",
      expiresAt: new Date("2026-09-27T00:00:00Z"),
      refreshExpiresAt: new Date("2026-10-12T00:00:00Z"),
    });

    const upsertCall = supabase.from.mock.results[0]!.value.upsert.mock.calls[0]![0];
    expect(JSON.stringify(upsertCall)).not.toMatch(/very-secret|top-secret/);
    expect(upsertCall).toMatchObject({ tenant_id: TENANT_ID, provider: "melhor_envio", status: "connected" });
    expect(upsertCall).not.toHaveProperty("access_token");
    expect(upsertCall).not.toHaveProperty("refresh_token");
  });
});
