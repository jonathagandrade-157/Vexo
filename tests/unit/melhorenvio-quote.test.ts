import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CLIENT_ID = "test-me-client-id";
const CLIENT_SECRET = "test-me-client-secret";
const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const ACCESS_TOKEN = "access-token-value";
const REFRESH_TOKEN = "refresh-token-value";
const CLIENT_SECRET_ENV = CLIENT_SECRET;

const PRODUCT: {
  id: string;
  height: number;
  width: number;
  length: number;
  weight: number;
  insuranceValue: number;
  quantity: number;
} = {
  id: "22222222-2222-2222-2222-222222222222",
  height: 10,
  width: 15,
  length: 20,
  weight: 1.25,
  insuranceValue: 100,
  quantity: 2,
};

/**
 * D3.2-B Ponto 2C — cliente de cotação (`calculateShipmentQuote`).
 * `ensureFreshMelhorEnvioToken` é mockado diretamente (já testado à
 * exaustão em `shipping-token-refresh.test.ts`) — aqui o foco é só o
 * cliente HTTP em si: URL/payload/headers montados corretamente,
 * conversão da resposta, e todo tratamento de erro.
 */
vi.mock("@/lib/shipping-connections/refresh", () => ({
  ensureFreshMelhorEnvioToken: vi.fn(),
}));

async function importModules() {
  const refreshModule = await import("@/lib/shipping-connections/refresh");
  const quoteModule = await import("@/lib/shipping-connections/melhorenvio-quote");
  return { ensureFreshMelhorEnvioToken: vi.mocked(refreshModule.ensureFreshMelhorEnvioToken), ...quoteModule };
}

describe("calculateShipmentQuote", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    global.fetch = vi.fn();
    Object.assign(process.env, {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
      NEXT_PUBLIC_STOREFRONT_DOMAIN_SUFFIX: "vexo.local",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      TRIAL_HASH_SECRET: "a-trial-hash-secret-thats-long-enough",
      MELHOR_ENVIO_CLIENT_ID: CLIENT_ID,
      MELHOR_ENVIO_CLIENT_SECRET: CLIENT_SECRET_ENV,
      OAUTH_STATE_SECRET: "a-oauth-state-secret-thats-long-enough",
    });
    delete process.env.MELHOR_ENVIO_SANDBOX;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  function mockConnectedToken() {
    return { status: "valid" as const, accessToken: ACCESS_TOKEN };
  }

  it("1. builds the sandbox URL by default (MELHOR_ENVIO_SANDBOX unset)", async () => {
    const { ensureFreshMelhorEnvioToken, calculateShipmentQuote } = await importModules();
    ensureFreshMelhorEnvioToken.mockResolvedValue(mockConnectedToken());
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    await calculateShipmentQuote({ tenantId: TENANT_ID, originZip: "00000000", destinationZip: "11111111", products: [PRODUCT], services: [1] });
    expect(vi.mocked(global.fetch).mock.calls[0]![0]).toBe("https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate");
  });

  it("2. builds the production URL when MELHOR_ENVIO_SANDBOX=false", async () => {
    process.env.MELHOR_ENVIO_SANDBOX = "false";
    const { ensureFreshMelhorEnvioToken, calculateShipmentQuote } = await importModules();
    ensureFreshMelhorEnvioToken.mockResolvedValue(mockConnectedToken());
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    await calculateShipmentQuote({ tenantId: TENANT_ID, originZip: "00000000", destinationZip: "11111111", products: [PRODUCT], services: [1] });
    expect(vi.mocked(global.fetch).mock.calls[0]![0]).toBe("https://melhorenvio.com.br/api/v2/me/shipment/calculate");
  });

  it("3/4/5/6. posts with Authorization Bearer, Accept application/json, Content-Type application/json", async () => {
    const { ensureFreshMelhorEnvioToken, calculateShipmentQuote } = await importModules();
    ensureFreshMelhorEnvioToken.mockResolvedValue(mockConnectedToken());
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    await calculateShipmentQuote({ tenantId: TENANT_ID, originZip: "00000000", destinationZip: "11111111", products: [PRODUCT], services: [1] });

    const [, init] = vi.mocked(global.fetch).mock.calls[0]!;
    expect(init!.method).toBe("POST");
    const headers = init!.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(headers.accept).toBe("application/json");
    expect(headers["content-type"]).toBe("application/json");
  });

  it("7/8. sends the exact normalized origin/destination postal codes", async () => {
    const { ensureFreshMelhorEnvioToken, calculateShipmentQuote } = await importModules();
    ensureFreshMelhorEnvioToken.mockResolvedValue(mockConnectedToken());
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    await calculateShipmentQuote({ tenantId: TENANT_ID, originZip: "00000-000", destinationZip: "11111-111", products: [PRODUCT], services: [1] });

    const [, init] = vi.mocked(global.fetch).mock.calls[0]!;
    const body = JSON.parse(init!.body as string);
    expect(body.from.postal_code).toBe("00000000");
    expect(body.to.postal_code).toBe("11111111");
  });

  it("throws when a postal code does not have exactly 8 digits", async () => {
    const { ensureFreshMelhorEnvioToken, calculateShipmentQuote } = await importModules();
    ensureFreshMelhorEnvioToken.mockResolvedValue(mockConnectedToken());
    await expect(
      calculateShipmentQuote({ tenantId: TENANT_ID, originZip: "123", destinationZip: "11111111", products: [PRODUCT], services: [1] }),
    ).rejects.toThrow(/originZip/);
  });

  it("9/10/11/12/13. builds products[] with id/height/width/length/weight/insurance_value/quantity mapped correctly", async () => {
    const { ensureFreshMelhorEnvioToken, calculateShipmentQuote } = await importModules();
    ensureFreshMelhorEnvioToken.mockResolvedValue(mockConnectedToken());
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    await calculateShipmentQuote({ tenantId: TENANT_ID, originZip: "00000000", destinationZip: "11111111", products: [PRODUCT], services: [1] });

    const [, init] = vi.mocked(global.fetch).mock.calls[0]!;
    const body = JSON.parse(init!.body as string);
    expect(body.products).toEqual([
      { id: PRODUCT.id, height: 10, width: 15, length: 20, weight: 1.25, insurance_value: 100, quantity: 2 },
    ]);
    expect(body.volumes).toBeUndefined();
  });

  it("14. joins multiple services as a comma-separated string, never inventing a default list", async () => {
    const { ensureFreshMelhorEnvioToken, calculateShipmentQuote } = await importModules();
    ensureFreshMelhorEnvioToken.mockResolvedValue(mockConnectedToken());
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    await calculateShipmentQuote({ tenantId: TENANT_ID, originZip: "00000000", destinationZip: "11111111", products: [PRODUCT], services: [1, 2, 3] });

    const [, init] = vi.mocked(global.fetch).mock.calls[0]!;
    const body = JSON.parse(init!.body as string);
    expect(body.services).toBe("1,2,3");
  });

  it("throws when services is empty — never assumes a default list", async () => {
    const { ensureFreshMelhorEnvioToken, calculateShipmentQuote } = await importModules();
    ensureFreshMelhorEnvioToken.mockResolvedValue(mockConnectedToken());
    await expect(
      calculateShipmentQuote({ tenantId: TENANT_ID, originZip: "00000000", destinationZip: "11111111", products: [PRODUCT], services: [] }),
    ).rejects.toThrow(/services/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("15/16/17/18. converts a valid response: price string→number, currency→BRL, delivery_time preserved", async () => {
    const { ensureFreshMelhorEnvioToken, calculateShipmentQuote } = await importModules();
    ensureFreshMelhorEnvioToken.mockResolvedValue(mockConnectedToken());
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(
        JSON.stringify([
          { id: 1, name: "PAC", price: "27.48", currency: "R$", delivery_time: 10, company: { id: 1, name: "Correios" } },
        ]),
        { status: 200 },
      ),
    );

    const result = await calculateShipmentQuote({
      tenantId: TENANT_ID,
      originZip: "00000000",
      destinationZip: "11111111",
      products: [PRODUCT],
      services: [1],
    });

    expect(result).toEqual({
      status: "ok",
      options: [{ provider: "melhor_envio", serviceId: "1", name: "PAC", price: 27.48, deliveryTime: 10, currency: "BRL" }],
    });
  });

  it("19. discards an entry missing/invalid id/name/price/delivery_time instead of throwing, keeping valid entries", async () => {
    const { ensureFreshMelhorEnvioToken, calculateShipmentQuote } = await importModules();
    ensureFreshMelhorEnvioToken.mockResolvedValue(mockConnectedToken());
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(
        JSON.stringify([
          { id: 1, name: "PAC", price: "27.48", delivery_time: 10 },
          { id: 2, name: "SEDEX", price: "not-a-number", delivery_time: 5 },
          { id: 3, name: "", price: "10.00", delivery_time: 3 },
          { id: 4, name: "Jadlog", price: "-5.00", delivery_time: 3 },
          { id: 5, name: "Azul", price: "5.00", delivery_time: -1 },
          { id: 6, name: "Latam", price: "5.00", delivery_time: 1.5 },
        ]),
        { status: 200 },
      ),
    );

    const result = await calculateShipmentQuote({
      tenantId: TENANT_ID,
      originZip: "00000000",
      destinationZip: "11111111",
      products: [PRODUCT],
      services: [1],
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.options).toHaveLength(1);
      expect(result.options[0]!.serviceId).toBe("1");
    }
  });

  it("returns unavailable/upstream_error when the response is not a JSON array", async () => {
    const { ensureFreshMelhorEnvioToken, calculateShipmentQuote } = await importModules();
    ensureFreshMelhorEnvioToken.mockResolvedValue(mockConnectedToken());
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify({ error: "unexpected" }), { status: 200 }));

    const result = await calculateShipmentQuote({
      tenantId: TENANT_ID,
      originZip: "00000000",
      destinationZip: "11111111",
      products: [PRODUCT],
      services: [1],
    });
    expect(result).toEqual({ status: "unavailable", reason: "upstream_error" });
  });

  it("20/21. never calls the HTTP API when the token is not connected/needs reconnection (products already assumed complete by the caller)", async () => {
    const { ensureFreshMelhorEnvioToken, calculateShipmentQuote } = await importModules();

    ensureFreshMelhorEnvioToken.mockResolvedValue({ status: "not_connected", accessToken: null });
    const notConnected = await calculateShipmentQuote({
      tenantId: TENANT_ID,
      originZip: "00000000",
      destinationZip: "11111111",
      products: [PRODUCT],
      services: [1],
    });
    expect(notConnected).toEqual({ status: "unavailable", reason: "not_connected" });
    expect(global.fetch).not.toHaveBeenCalled();

    ensureFreshMelhorEnvioToken.mockResolvedValue({ status: "needs_reconnection", accessToken: null });
    const needsReconnection = await calculateShipmentQuote({
      tenantId: TENANT_ID,
      originZip: "00000000",
      destinationZip: "11111111",
      products: [PRODUCT],
      services: [1],
    });
    expect(needsReconnection).toEqual({ status: "unavailable", reason: "needs_reconnection" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("22. treats HTTP 401 as upstream_error, never inferring reconnection is needed", async () => {
    const { ensureFreshMelhorEnvioToken, calculateShipmentQuote } = await importModules();
    ensureFreshMelhorEnvioToken.mockResolvedValue(mockConnectedToken());
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));

    const result = await calculateShipmentQuote({
      tenantId: TENANT_ID,
      originZip: "00000000",
      destinationZip: "11111111",
      products: [PRODUCT],
      services: [1],
    });
    expect(result).toEqual({ status: "unavailable", reason: "upstream_error" });
  });

  it("23. treats HTTP 403 as upstream_error, never inferring reconnection is needed", async () => {
    const { ensureFreshMelhorEnvioToken, calculateShipmentQuote } = await importModules();
    ensureFreshMelhorEnvioToken.mockResolvedValue(mockConnectedToken());
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }));

    const result = await calculateShipmentQuote({
      tenantId: TENANT_ID,
      originZip: "00000000",
      destinationZip: "11111111",
      products: [PRODUCT],
      services: [1],
    });
    expect(result).toEqual({ status: "unavailable", reason: "upstream_error" });
  });

  it("24. treats HTTP 429 as temporarily_unavailable", async () => {
    const { ensureFreshMelhorEnvioToken, calculateShipmentQuote } = await importModules();
    ensureFreshMelhorEnvioToken.mockResolvedValue(mockConnectedToken());
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify({ error: "too_many_requests" }), { status: 429 }));

    const result = await calculateShipmentQuote({
      tenantId: TENANT_ID,
      originZip: "00000000",
      destinationZip: "11111111",
      products: [PRODUCT],
      services: [1],
    });
    expect(result).toEqual({ status: "unavailable", reason: "temporarily_unavailable" });
  });

  it("25. treats HTTP 5xx as temporarily_unavailable", async () => {
    const { ensureFreshMelhorEnvioToken, calculateShipmentQuote } = await importModules();
    ensureFreshMelhorEnvioToken.mockResolvedValue(mockConnectedToken());
    for (const status of [500, 502, 503, 504]) {
      vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: "server_error" }), { status }));
      const result = await calculateShipmentQuote({
        tenantId: TENANT_ID,
        originZip: "00000000",
        destinationZip: "11111111",
        products: [PRODUCT],
        services: [1],
      });
      expect(result).toEqual({ status: "unavailable", reason: "temporarily_unavailable" });
    }
  });

  it("26. treats a timeout as temporarily_unavailable, never hanging indefinitely", async () => {
    const { ensureFreshMelhorEnvioToken, calculateShipmentQuote } = await importModules();
    ensureFreshMelhorEnvioToken.mockResolvedValue(mockConnectedToken());
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

    const result = await calculateShipmentQuote({
      tenantId: TENANT_ID,
      originZip: "00000000",
      destinationZip: "11111111",
      products: [PRODUCT],
      services: [1],
      timeoutMs: 5,
    });
    expect(result).toEqual({ status: "unavailable", reason: "temporarily_unavailable" });
  });

  it("treats a network error as temporarily_unavailable", async () => {
    const { ensureFreshMelhorEnvioToken, calculateShipmentQuote } = await importModules();
    ensureFreshMelhorEnvioToken.mockResolvedValue(mockConnectedToken());
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    const result = await calculateShipmentQuote({
      tenantId: TENANT_ID,
      originZip: "00000000",
      destinationZip: "11111111",
      products: [PRODUCT],
      services: [1],
    });
    expect(result).toEqual({ status: "unavailable", reason: "temporarily_unavailable" });
  });

  it("27/28/29. never leaks access_token/refresh_token/client_secret in a thrown error", async () => {
    const { ensureFreshMelhorEnvioToken, calculateShipmentQuote } = await importModules();
    ensureFreshMelhorEnvioToken.mockResolvedValue(mockConnectedToken());
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    try {
      await calculateShipmentQuote({ tenantId: TENANT_ID, originZip: "123", destinationZip: "11111111", products: [PRODUCT], services: [1] });
    } catch (err) {
      const message = String((err as Error).message);
      expect(message).not.toContain(ACCESS_TOKEN);
      expect(message).not.toContain(REFRESH_TOKEN);
      expect(message).not.toContain(CLIENT_SECRET);
    }

    const result = await calculateShipmentQuote({
      tenantId: TENANT_ID,
      originZip: "00000000",
      destinationZip: "11111111",
      products: [PRODUCT],
      services: [1],
    });
    expect(JSON.stringify(result)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(result)).not.toContain(REFRESH_TOKEN);
    expect(JSON.stringify(result)).not.toContain(CLIENT_SECRET);
  });

  it("30. the base URL is always derived server-side from MELHOR_ENVIO_SANDBOX — no parameter accepts a base URL from the caller", async () => {
    const { ensureFreshMelhorEnvioToken, calculateShipmentQuote } = await importModules();
    ensureFreshMelhorEnvioToken.mockResolvedValue(mockConnectedToken());
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    const params = {
      tenantId: TENANT_ID,
      originZip: "00000000",
      destinationZip: "11111111",
      products: [PRODUCT],
      services: [1],
    };
    // A assinatura de CalculateShipmentQuoteParams não tem nenhum campo de
    // base/URL — só é possível confirmar isso estruturalmente: chamando a
    // função com os parâmetros documentados e checando que a URL chamada
    // é sempre uma das duas bases fixas, nunca algo derivado de `params`.
    await calculateShipmentQuote(params);
    const calledUrl = vi.mocked(global.fetch).mock.calls[0]![0] as string;
    expect(["https://sandbox.melhorenvio.com.br", "https://melhorenvio.com.br"]).toContain(new URL(calledUrl).origin);
  });
});
