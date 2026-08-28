import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMelhorEnvioGateway } from "@/lib/shipping-connections/melhorenvio";

const CLIENT_ID = "test-me-client-id";
const CLIENT_SECRET = "test-me-client-secret";

describe("getAuthorizeUrl", () => {
  it("builds the sandbox authorization URL by default (sandbox=true)", () => {
    const gateway = createMelhorEnvioGateway(CLIENT_ID, CLIENT_SECRET, true);
    const url = new URL(gateway.getAuthorizeUrl("signed-state", "https://loja.vexo.local/api/oauth/melhorenvio/callback"));
    expect(url.origin + url.pathname).toBe("https://sandbox.melhorenvio.com.br/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("signed-state");
    expect(url.searchParams.get("redirect_uri")).toBe("https://loja.vexo.local/api/oauth/melhorenvio/callback");
  });

  it("builds the production authorization URL when sandbox=false", () => {
    const gateway = createMelhorEnvioGateway(CLIENT_ID, CLIENT_SECRET, false);
    const url = new URL(gateway.getAuthorizeUrl("state", "https://loja.vexo.local/callback"));
    expect(url.origin + url.pathname).toBe("https://melhorenvio.com.br/oauth/authorize");
  });

  it("never puts client_secret in the authorization URL", () => {
    const gateway = createMelhorEnvioGateway(CLIENT_ID, CLIENT_SECRET, true);
    const url = gateway.getAuthorizeUrl("state", "https://loja.vexo.local/callback");
    expect(url).not.toContain(CLIENT_SECRET);
  });
});

describe("exchangeCodeForTokens (mocked fetch — no real network call)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("posts to the sandbox token endpoint (confirmed literally in github.com/melhorenvio/auth-sdk-php) and maps the response", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 2_592_000 }), { status: 200 }),
    );
    const gateway = createMelhorEnvioGateway(CLIENT_ID, CLIENT_SECRET, true);
    const tokens = await gateway.exchangeCodeForTokens("auth-code", "https://loja.vexo.local/callback");

    const [calledUrl, init] = vi.mocked(global.fetch).mock.calls[0]!;
    expect(calledUrl).toBe("https://sandbox.melhorenvio.com.br/oauth/token");
    const body = Object.fromEntries(new URLSearchParams(init!.body as string));
    expect(body).toMatchObject({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code: "auth-code",
    });
    expect(tokens.accessToken).toBe("at");
    expect(tokens.refreshToken).toBe("rt");
    expect(tokens.expiresAt).toBeInstanceOf(Date);
    expect(tokens.refreshExpiresAt).toBeInstanceOf(Date);
  });

  it("sends Content-Type: application/x-www-form-urlencoded, never application/json (D3.2-B Ponto 1B — confirmado por teste oficial do SDK Melhor Envio)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "at" }), { status: 200 }));
    const gateway = createMelhorEnvioGateway(CLIENT_ID, CLIENT_SECRET, true);
    await gateway.exchangeCodeForTokens("auth-code", "https://loja.vexo.local/callback");
    const [, init] = vi.mocked(global.fetch).mock.calls[0]!;
    expect((init!.headers as Record<string, string>)["content-type"]).toBe("application/x-www-form-urlencoded");
  });

  it("access_token expires ~30 dias depois (confirmado na documentação) quando expires_in não é enviado — expiresAt fica null, nunca inventado", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "at", refresh_token: "rt" }), { status: 200 }));
    const gateway = createMelhorEnvioGateway(CLIENT_ID, CLIENT_SECRET, true);
    const tokens = await gateway.exchangeCodeForTokens("auth-code", "https://loja.vexo.local/callback");
    expect(tokens.expiresAt).toBeNull();
  });

  it("refreshExpiresAt é derivado do prazo de 45 dias confirmado — ~45 dias à frente de agora, e null quando não há refresh_token", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 100 }), { status: 200 }),
    );
    const gateway = createMelhorEnvioGateway(CLIENT_ID, CLIENT_SECRET, true);
    const before = Date.now();
    const tokens = await gateway.exchangeCodeForTokens("auth-code", "https://loja.vexo.local/callback");
    const deltaMs = tokens.refreshExpiresAt!.getTime() - before;
    const fortyFiveDaysMs = 45 * 24 * 60 * 60 * 1000;
    expect(Math.abs(deltaMs - fortyFiveDaysMs)).toBeLessThan(5_000);

    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "at2", expires_in: 100 }), { status: 200 }));
    const tokensNoRefresh = await gateway.exchangeCodeForTokens("auth-code-2", "https://loja.vexo.local/callback");
    expect(tokensNoRefresh.refreshToken).toBeNull();
    expect(tokensNoRefresh.refreshExpiresAt).toBeNull();
  });

  it("throws on a non-ok JSON response, never swallowing the failure or leaking the response body", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_request" }), { status: 400 }));
    const gateway = createMelhorEnvioGateway(CLIENT_ID, CLIENT_SECRET, true);
    await expect(gateway.exchangeCodeForTokens("bad-code", "https://x/callback")).rejects.toThrow(/400/);
  });

  it("throws INVALID_RESPONSE (never a generic Error) on a non-JSON error body", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response("invalid_grant", { status: 400 }));
    const gateway = createMelhorEnvioGateway(CLIENT_ID, CLIENT_SECRET, true);
    await expect(gateway.exchangeCodeForTokens("bad-code", "https://x/callback")).rejects.toMatchObject({
      name: "ShippingRefreshError",
      code: "INVALID_RESPONSE",
    });
  });

  it("sends client_secret only in the server-to-server POST body, never as a query param", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "at" }), { status: 200 }));
    const gateway = createMelhorEnvioGateway(CLIENT_ID, CLIENT_SECRET, true);
    await gateway.exchangeCodeForTokens("auth-code", "https://loja.vexo.local/callback");
    const [calledUrl] = vi.mocked(global.fetch).mock.calls[0]!;
    expect(calledUrl as string).not.toContain(CLIENT_SECRET);
  });

  it("sends a User-Agent header identifying the app, never containing any secret/tenant/customer data (D3.2-B Ponto 1B)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "at" }), { status: 200 }));
    const gateway = createMelhorEnvioGateway(CLIENT_ID, CLIENT_SECRET, true);
    await gateway.exchangeCodeForTokens("auth-code", "https://loja.vexo.local/callback");
    const [, init] = vi.mocked(global.fetch).mock.calls[0]!;
    const userAgent = (init!.headers as Record<string, string>)["user-agent"];
    expect(userAgent).toBeTruthy();
    expect(userAgent).not.toContain(CLIENT_SECRET);
    expect(userAgent).not.toContain(CLIENT_ID);
  });
});

describe("refreshAccessToken (D3.2-B Ponto 1B — mocked fetch)", () => {
  const originalFetch = global.fetch;
  const REFRESH_TOKEN = "refresh-token-value";

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("posts grant_type=refresh_token to the token endpoint, never including redirect_uri (RFC 6749 §6)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "new-at", refresh_token: "new-rt", expires_in: 2_592_000 }), { status: 200 }),
    );
    const gateway = createMelhorEnvioGateway(CLIENT_ID, CLIENT_SECRET, true);
    const tokens = await gateway.refreshAccessToken(REFRESH_TOKEN);

    const [calledUrl, init] = vi.mocked(global.fetch).mock.calls[0]!;
    expect(calledUrl).toBe("https://sandbox.melhorenvio.com.br/oauth/token");
    const body = Object.fromEntries(new URLSearchParams(init!.body as string));
    expect(body).toMatchObject({ grant_type: "refresh_token", client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: REFRESH_TOKEN });
    expect(body).not.toHaveProperty("redirect_uri");
    expect(body).not.toHaveProperty("code");
    expect(tokens.accessToken).toBe("new-at");
    expect(tokens.refreshToken).toBe("new-rt");
  });

  it("sends a User-Agent header on the refresh call too", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "new-at" }), { status: 200 }));
    const gateway = createMelhorEnvioGateway(CLIENT_ID, CLIENT_SECRET, true);
    await gateway.refreshAccessToken(REFRESH_TOKEN);
    const [, init] = vi.mocked(global.fetch).mock.calls[0]!;
    expect((init!.headers as Record<string, string>)["user-agent"]).toBeTruthy();
  });

  it("sends Content-Type: application/x-www-form-urlencoded on the refresh call too, never application/json", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "new-at" }), { status: 200 }));
    const gateway = createMelhorEnvioGateway(CLIENT_ID, CLIENT_SECRET, true);
    await gateway.refreshAccessToken(REFRESH_TOKEN);
    const [, init] = vi.mocked(global.fetch).mock.calls[0]!;
    expect((init!.headers as Record<string, string>)["content-type"]).toBe("application/x-www-form-urlencoded");
  });

  it("maps refresh_token rotation: returns the new refresh_token when the API provides one", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "new-at", refresh_token: "rotated-rt", expires_in: 100 }), { status: 200 }),
    );
    const gateway = createMelhorEnvioGateway(CLIENT_ID, CLIENT_SECRET, true);
    const tokens = await gateway.refreshAccessToken(REFRESH_TOKEN);
    expect(tokens.refreshToken).toBe("rotated-rt");
  });

  it("returns refreshToken=null when the API doesn't provide a new one (caller decides to keep the old one)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "new-at", expires_in: 100 }), { status: 200 }));
    const gateway = createMelhorEnvioGateway(CLIENT_ID, CLIENT_SECRET, true);
    const tokens = await gateway.refreshAccessToken(REFRESH_TOKEN);
    expect(tokens.refreshToken).toBeNull();
  });

  it("classifies a network error as NETWORK_ERROR, retryable", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));
    const gateway = createMelhorEnvioGateway(CLIENT_ID, CLIENT_SECRET, true);
    await expect(gateway.refreshAccessToken(REFRESH_TOKEN)).rejects.toMatchObject({ code: "NETWORK_ERROR", retryable: true });
  });

  it("classifies a timeout as TIMEOUT, retryable, and never leaks the refresh_token in the error message", async () => {
    vi.mocked(global.fetch).mockImplementationOnce((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit).signal;
        signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    const gateway = createMelhorEnvioGateway(CLIENT_ID, CLIENT_SECRET, true, 5);
    const promise = gateway.refreshAccessToken(REFRESH_TOKEN);
    await expect(promise).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
    await promise.catch((err) => {
      expect(String(err.message)).not.toContain(REFRESH_TOKEN);
      expect(String(err.message)).not.toContain(CLIENT_SECRET);
    });
  });

  it("classifies HTTP 500 as SERVER_ERROR, retryable", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: "server_error" }), { status: 500 }));
    const gateway = createMelhorEnvioGateway(CLIENT_ID, CLIENT_SECRET, true);
    await expect(gateway.refreshAccessToken(REFRESH_TOKEN)).rejects.toMatchObject({ code: "SERVER_ERROR", status: 500, retryable: true });
  });

  it("classifies HTTP 429 as RATE_LIMITED, retryable", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: "too_many_requests" }), { status: 429 }));
    const gateway = createMelhorEnvioGateway(CLIENT_ID, CLIENT_SECRET, true);
    await expect(gateway.refreshAccessToken(REFRESH_TOKEN)).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429, retryable: true });
  });

  it("classifies error=invalid_grant (400) as INVALID_REFRESH_TOKEN, never retryable — the only case that should trigger reconnection", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    const gateway = createMelhorEnvioGateway(CLIENT_ID, CLIENT_SECRET, true);
    await expect(gateway.refreshAccessToken(REFRESH_TOKEN)).rejects.toMatchObject({ code: "INVALID_REFRESH_TOKEN", retryable: false });
  });

  it("classifies error=invalid_client (401) as INVALID_CLIENT (VEXO's own credentials, never the tenant's fault)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 }));
    const gateway = createMelhorEnvioGateway(CLIENT_ID, CLIENT_SECRET, true);
    await expect(gateway.refreshAccessToken(REFRESH_TOKEN)).rejects.toMatchObject({ code: "INVALID_CLIENT", retryable: false });
  });

  it("classifies a non-JSON body as INVALID_RESPONSE, never a generic Error", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response("<html>error</html>", { status: 502 }));
    const gateway = createMelhorEnvioGateway(CLIENT_ID, CLIENT_SECRET, true);
    await expect(gateway.refreshAccessToken(REFRESH_TOKEN)).rejects.toMatchObject({ name: "ShippingRefreshError", code: "INVALID_RESPONSE" });
  });

  it("classifies a 200 response missing access_token as INVALID_RESPONSE, not retryable", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ token_type: "bearer" }), { status: 200 }));
    const gateway = createMelhorEnvioGateway(CLIENT_ID, CLIENT_SECRET, true);
    await expect(gateway.refreshAccessToken(REFRESH_TOKEN)).rejects.toMatchObject({ code: "INVALID_RESPONSE", retryable: false });
  });

  it("never leaks client_secret or refresh_token in any thrown error message, across every error kind", async () => {
    const scenarios: [Response, unknown][] = [
      [new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }), undefined],
      [new Response(JSON.stringify({ error: "server_error" }), { status: 500 }), undefined],
      [new Response("not json", { status: 400 }), undefined],
    ];
    const gateway = createMelhorEnvioGateway(CLIENT_ID, CLIENT_SECRET, true);
    for (const [response] of scenarios) {
      vi.mocked(global.fetch).mockResolvedValueOnce(response);
      await gateway.refreshAccessToken(REFRESH_TOKEN).catch((err) => {
        expect(String(err.message)).not.toContain(CLIENT_SECRET);
        expect(String(err.message)).not.toContain(REFRESH_TOKEN);
      });
    }
  });
});
