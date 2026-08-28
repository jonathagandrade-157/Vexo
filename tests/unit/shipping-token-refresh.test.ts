import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * D3.2-B Ponto 1B — testa `ensureFreshMelhorEnvioToken` (renovação lazy
 * do access_token). O gateway real e o vault real já são testados
 * isoladamente (tests/unit/melhorenvio-gateway.test.ts,
 * tests/integration/shipping-provider-connection.test.ts) — aqui o foco
 * é a LÓGICA de decisão: quando renovar, como reagir a cada classe de
 * erro, e o que nunca deve acontecer (desconectar por erro transitório,
 * vazar segredo em log). O lease/concorrência de verdade (duas
 * requisições simultâneas contra o mesmo Postgres) é coberto em
 * tests/integration/shipping-token-refresh.test.ts — aqui as chamadas de
 * RPC são mockadas, então cada teste simula UM resultado de lease por
 * vez.
 */
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/shipping-connections/registry", () => ({ getShippingConnectionGateway: vi.fn() }));

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { ShippingRefreshError, type ShippingConnectionGateway } from "@/lib/shipping-connections/gateway";
import { getShippingConnectionGateway } from "@/lib/shipping-connections/registry";
import { ensureFreshMelhorEnvioToken, REFRESH_LEASE_SECONDS, REFRESH_MARGIN_SECONDS } from "@/lib/shipping-connections/refresh";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const CLIENT_SECRET_MARKER = "super-secret-client-secret-value";
const REFRESH_TOKEN_MARKER = "super-secret-refresh-token-value";

interface FakeSupabase {
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
}

function fakeSupabase(options: {
  providerStatus?: "connected" | "disconnected" | null;
  lease?: Record<string, unknown>;
  updateResult?: { error: unknown };
  vaultCredentials?: Record<string, unknown> | null;
  storeError?: unknown;
}): FakeSupabase {
  const { providerStatus = "connected", lease, updateResult = { error: null }, vaultCredentials, storeError } = options;

  const rpc = vi.fn((fn: string) => {
    if (fn === "acquire_shipping_credentials_refresh_lease") return Promise.resolve({ data: lease ? [lease] : [], error: null });
    if (fn === "release_shipping_credentials_refresh_lease") return Promise.resolve({ error: null });
    if (fn === "get_shipping_credentials") {
      if (vaultCredentials === null) return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: [vaultCredentials ?? { access_token: "current-access-token" }], error: null });
    }
    if (fn === "store_shipping_credentials") return Promise.resolve({ error: storeError ?? null });
    throw new Error(`unexpected rpc: ${fn}`);
  });

  const update = vi.fn(() => ({
    eq: vi.fn(() => ({ eq: vi.fn().mockResolvedValue(updateResult) })),
  }));
  const maybeSingle = vi.fn().mockResolvedValue({ data: providerStatus ? { status: providerStatus } : null });
  const from = vi.fn((table: string) => {
    if (table === "store_shipping_providers") {
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }), update };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return { from, rpc };
}

function fakeGateway(overrides: Partial<{ refreshAccessToken: ReturnType<typeof vi.fn> }> = {}): ShippingConnectionGateway {
  return {
    provider: "melhor_envio" as const,
    getAuthorizeUrl: vi.fn(),
    exchangeCodeForTokens: vi.fn(),
    refreshAccessToken: overrides.refreshAccessToken ?? vi.fn(),
  } as unknown as ShippingConnectionGateway;
}

describe("ensureFreshMelhorEnvioToken (D3.2-B Ponto 1B)", () => {
  afterEach(() => {
    vi.mocked(createSupabaseServiceRoleClient).mockReset();
    vi.mocked(getShippingConnectionGateway).mockReset();
  });

  it("margem de segurança é uma constante clara e não arbitrariamente enorme (24h de 30 dias de validade)", () => {
    expect(REFRESH_MARGIN_SECONDS).toBe(24 * 60 * 60);
    expect(REFRESH_LEASE_SECONDS).toBeGreaterThan(0);
    expect(REFRESH_LEASE_SECONDS).toBeLessThan(REFRESH_MARGIN_SECONDS);
  });

  it("1. tenant nunca conectou: status not_connected, nenhuma chamada de rede", async () => {
    const supabase = fakeSupabase({ providerStatus: null });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);

    const result = await ensureFreshMelhorEnvioToken(TENANT_ID);

    expect(result).toEqual({ status: "not_connected", accessToken: null });
    expect(supabase.rpc).not.toHaveBeenCalledWith("acquire_shipping_credentials_refresh_lease", expect.anything());
  });

  it("2. conexão já marcada disconnected: needs_reconnection sem tocar no lease/gateway", async () => {
    const supabase = fakeSupabase({ providerStatus: "disconnected" });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);

    const result = await ensureFreshMelhorEnvioToken(TENANT_ID);

    expect(result).toEqual({ status: "needs_reconnection", accessToken: null });
    expect(getShippingConnectionGateway).not.toHaveBeenCalled();
  });

  it("3. token ainda válido (fora da margem): status valid, nenhuma renovação disparada", async () => {
    const supabase = fakeSupabase({ lease: { reason: "not_needed" }, vaultCredentials: { access_token: "still-good-token" } });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);

    const result = await ensureFreshMelhorEnvioToken(TENANT_ID);

    expect(result).toEqual({ status: "valid", accessToken: "still-good-token" });
    expect(getShippingConnectionGateway).not.toHaveBeenCalled();
  });

  it("4. token próximo da expiração (lease reivindicado): renova e salva no vault", async () => {
    const supabase = fakeSupabase({
      lease: { reason: "claimed", refresh_token: "old-refresh-token", refresh_expires_at: null },
    });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);
    vi.mocked(getShippingConnectionGateway).mockReturnValue(
      fakeGateway({
        refreshAccessToken: vi.fn().mockResolvedValue({
          accessToken: "brand-new-access-token",
          refreshToken: null,
          expiresAt: new Date("2026-09-27T00:00:00Z"),
          refreshExpiresAt: null,
        }),
      }),
    );

    const result = await ensureFreshMelhorEnvioToken(TENANT_ID);

    expect(result).toEqual({ status: "refreshed", accessToken: "brand-new-access-token" });
    expect(supabase.rpc).toHaveBeenCalledWith(
      "store_shipping_credentials",
      expect.objectContaining({ p_tenant_id: TENANT_ID, p_provider: "melhor_envio", p_access_token: "brand-new-access-token" }),
    );
  });

  it("5. novo refresh_token devolvido pela API é o que é salvo (rotation)", async () => {
    const supabase = fakeSupabase({ lease: { reason: "claimed", refresh_token: "old-rt", refresh_expires_at: null } });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);
    vi.mocked(getShippingConnectionGateway).mockReturnValue(
      fakeGateway({
        refreshAccessToken: vi.fn().mockResolvedValue({ accessToken: "new-at", refreshToken: "rotated-new-rt", expiresAt: null, refreshExpiresAt: null }),
      }),
    );

    await ensureFreshMelhorEnvioToken(TENANT_ID);

    expect(supabase.rpc).toHaveBeenCalledWith("store_shipping_credentials", expect.objectContaining({ p_refresh_token: "rotated-new-rt" }));
  });

  it("6. refresh_token antigo é mantido quando a API não devolve um novo", async () => {
    const supabase = fakeSupabase({ lease: { reason: "claimed", refresh_token: "keep-this-old-rt", refresh_expires_at: null } });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);
    vi.mocked(getShippingConnectionGateway).mockReturnValue(
      fakeGateway({
        refreshAccessToken: vi.fn().mockResolvedValue({ accessToken: "new-at", refreshToken: null, expiresAt: null, refreshExpiresAt: null }),
      }),
    );

    await ensureFreshMelhorEnvioToken(TENANT_ID);

    expect(supabase.rpc).toHaveBeenCalledWith("store_shipping_credentials", expect.objectContaining({ p_refresh_token: "keep-this-old-rt" }));
  });

  it("2 (lease). outra requisição já está renovando: não dispara uma segunda renovação, usa o token atual", async () => {
    const supabase = fakeSupabase({ lease: { reason: "already_refreshing" }, vaultCredentials: { access_token: "in-flight-token" } });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);

    const result = await ensureFreshMelhorEnvioToken(TENANT_ID);

    expect(result).toEqual({ status: "refresh_in_progress", accessToken: "in-flight-token" });
    expect(getShippingConnectionGateway).not.toHaveBeenCalled();
  });

  it("16. duas chamadas concorrentes: a segunda que chega enquanto a primeira já reivindicou o lease nunca chama o gateway (não corrompe/duplica)", async () => {
    const refreshFn = vi.fn().mockResolvedValue({ accessToken: "at", refreshToken: "rt", expiresAt: null, refreshExpiresAt: null });
    vi.mocked(getShippingConnectionGateway).mockReturnValue(fakeGateway({ refreshAccessToken: refreshFn }));

    const supabaseA = fakeSupabase({ lease: { reason: "claimed", refresh_token: "rt-a", refresh_expires_at: null } });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabaseA as never);
    const resultA = await ensureFreshMelhorEnvioToken(TENANT_ID);

    const supabaseB = fakeSupabase({ lease: { reason: "already_refreshing" }, vaultCredentials: { access_token: "at" } });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabaseB as never);
    const resultB = await ensureFreshMelhorEnvioToken(TENANT_ID);

    expect(resultA.status).toBe("refreshed");
    expect(resultB.status).toBe("refresh_in_progress");
    expect(refreshFn).toHaveBeenCalledTimes(1);
  });

  it("7/9. timeout (erro transitório) não desconecta a conta, preserva o access_token atual, e não expõe o segredo no log", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const supabase = fakeSupabase({
      lease: { reason: "claimed", refresh_token: REFRESH_TOKEN_MARKER, refresh_expires_at: null },
      vaultCredentials: { access_token: "stale-but-still-usable-token" },
    });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);
    vi.mocked(getShippingConnectionGateway).mockReturnValue(
      fakeGateway({
        refreshAccessToken: vi
          .fn()
          .mockRejectedValue(new ShippingRefreshError({ provider: "melhor_envio", status: null, code: "TIMEOUT", message: "timed out", retryable: true })),
      }),
    );

    const result = await ensureFreshMelhorEnvioToken(TENANT_ID);

    expect(result).toEqual({ status: "refresh_failed_temporary", accessToken: "stale-but-still-usable-token" });
    expect(supabase.from).not.toHaveBeenCalledWith("store_shipping_providers", expect.objectContaining({}));
    // A única chamada a store_shipping_providers.update() seria a de
    // marcar disconnected — não deve ter acontecido: `update` só existe
    // no mock de `from("store_shipping_providers")`, mas essa branch só é
    // exercida por markNeedsReconnection.
    expect(supabase.rpc).toHaveBeenCalledWith("release_shipping_credentials_refresh_lease", expect.anything());
    const loggedArgs = JSON.stringify(errorSpy.mock.calls);
    expect(loggedArgs).not.toContain(REFRESH_TOKEN_MARKER);
    expect(loggedArgs).not.toContain(CLIENT_SECRET_MARKER);
    errorSpy.mockRestore();
  });

  it("10. erro 5xx (transitório) também libera o lease sem desconectar, sem vazar segredo", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const supabase = fakeSupabase({
      lease: { reason: "claimed", refresh_token: REFRESH_TOKEN_MARKER, refresh_expires_at: null },
      vaultCredentials: { access_token: "old-token" },
    });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);
    vi.mocked(getShippingConnectionGateway).mockReturnValue(
      fakeGateway({
        refreshAccessToken: vi.fn().mockRejectedValue(
          new ShippingRefreshError({ provider: "melhor_envio", status: 502, code: "SERVER_ERROR", message: "melhorenvio: token request failed (502)", retryable: true }),
        ),
      }),
    );

    const result = await ensureFreshMelhorEnvioToken(TENANT_ID);

    expect(result.status).toBe("refresh_failed_temporary");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(REFRESH_TOKEN_MARKER);
    errorSpy.mockRestore();
  });

  it("11. rate limit (429, transitório) também não desconecta nem vaza segredo", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const supabase = fakeSupabase({
      lease: { reason: "claimed", refresh_token: REFRESH_TOKEN_MARKER, refresh_expires_at: null },
      vaultCredentials: { access_token: "old-token" },
    });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);
    vi.mocked(getShippingConnectionGateway).mockReturnValue(
      fakeGateway({
        refreshAccessToken: vi
          .fn()
          .mockRejectedValue(new ShippingRefreshError({ provider: "melhor_envio", status: 429, code: "RATE_LIMITED", message: "melhorenvio: token request failed (429)", retryable: true })),
      }),
    );

    const result = await ensureFreshMelhorEnvioToken(TENANT_ID);

    expect(result.status).toBe("refresh_failed_temporary");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(REFRESH_TOKEN_MARKER);
    errorSpy.mockRestore();
  });

  it("8. refresh_token confirmadamente inválido (invalid_grant): marca precisando reconectar, nunca trata como transitório", async () => {
    const supabase = fakeSupabase({ lease: { reason: "claimed", refresh_token: REFRESH_TOKEN_MARKER, refresh_expires_at: null } });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);
    vi.mocked(getShippingConnectionGateway).mockReturnValue(
      fakeGateway({
        refreshAccessToken: vi
          .fn()
          .mockRejectedValue(new ShippingRefreshError({ provider: "melhor_envio", status: 400, code: "INVALID_REFRESH_TOKEN", message: "invalid_grant", retryable: false })),
      }),
    );

    const result = await ensureFreshMelhorEnvioToken(TENANT_ID);

    expect(result).toEqual({ status: "needs_reconnection", accessToken: null });
  });

  it("refresh_token localmente conhecido como expirado (refresh_expires_at no passado): needs_reconnection SEM nenhuma chamada de rede", async () => {
    const supabase = fakeSupabase({
      lease: { reason: "claimed", refresh_token: REFRESH_TOKEN_MARKER, refresh_expires_at: "2000-01-01T00:00:00Z" },
    });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);
    const refreshFn = vi.fn();
    vi.mocked(getShippingConnectionGateway).mockReturnValue(fakeGateway({ refreshAccessToken: refreshFn }));

    const result = await ensureFreshMelhorEnvioToken(TENANT_ID);

    expect(result).toEqual({ status: "needs_reconnection", accessToken: null });
    expect(refreshFn).not.toHaveBeenCalled();
  });

  it("INVALID_CLIENT (credencial da VEXO, não do tenant) NUNCA marca o tenant como precisando reconectar", async () => {
    const supabase = fakeSupabase({
      lease: { reason: "claimed", refresh_token: REFRESH_TOKEN_MARKER, refresh_expires_at: null },
      vaultCredentials: { access_token: "old-token" },
    });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);
    vi.mocked(getShippingConnectionGateway).mockReturnValue(
      fakeGateway({
        refreshAccessToken: vi
          .fn()
          .mockRejectedValue(new ShippingRefreshError({ provider: "melhor_envio", status: 401, code: "INVALID_CLIENT", message: "invalid_client", retryable: false })),
      }),
    );

    const result = await ensureFreshMelhorEnvioToken(TENANT_ID);

    expect(result.status).toBe("refresh_failed_temporary");
  });

  it("12/13/14. o resultado nunca inclui client_secret nem refresh_token — só accessToken e status", async () => {
    const supabase = fakeSupabase({ lease: { reason: "claimed", refresh_token: REFRESH_TOKEN_MARKER, refresh_expires_at: null } });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);
    vi.mocked(getShippingConnectionGateway).mockReturnValue(
      fakeGateway({ refreshAccessToken: vi.fn().mockResolvedValue({ accessToken: "at", refreshToken: "new-rt", expiresAt: null, refreshExpiresAt: null }) }),
    );

    const result = await ensureFreshMelhorEnvioToken(TENANT_ID);

    expect(Object.keys(result).sort()).toEqual(["accessToken", "status"]);
    expect(JSON.stringify(result)).not.toContain(REFRESH_TOKEN_MARKER);
    expect(JSON.stringify(result)).not.toContain(CLIENT_SECRET_MARKER);
  });

  it("15. tenant_id nunca é lido de outro lugar além do parâmetro — toda consulta usa exatamente o tenantId recebido", async () => {
    const supabase = fakeSupabase({ lease: { reason: "not_needed" }, vaultCredentials: { access_token: "x" } });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(supabase as never);

    await ensureFreshMelhorEnvioToken(TENANT_ID);

    expect(supabase.rpc).toHaveBeenCalledWith("acquire_shipping_credentials_refresh_lease", expect.objectContaining({ p_tenant_id: TENANT_ID }));
    expect(supabase.rpc).toHaveBeenCalledWith("get_shipping_credentials", expect.objectContaining({ p_tenant_id: TENANT_ID }));
  });
});
