import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * D15-S.2 — testa o Route Handler de cotação de frete
 * (app/api/shipping/quote/route.ts), mesmo padrão de
 * tests/unit/cep-autofill-route.test.ts: mocka tudo que já é testado em
 * outro lugar (resolveStorefrontTenant, getShippingQuote,
 * checkRateLimit/getClientIp) e foca só na ORDEM e nas DECISÕES que este
 * arquivo toma por conta própria — em particular, que o rate limit é
 * checado ANTES de getShippingQuote (que é quem de fato chama o Melhor
 * Envio) e nunca depois.
 */
vi.mock("@/features/cart/cart-cookie", () => ({ getCartId: vi.fn(async () => null) }));
vi.mock("@/features/shipping/quote", () => ({ getShippingQuote: vi.fn() }));
vi.mock("@/features/storefront/resolve-tenant", () => ({ resolveStorefrontTenant: vi.fn() }));
vi.mock("@/lib/security/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/security/rate-limit")>("@/lib/security/rate-limit");
  return { ...actual, checkRateLimit: vi.fn(), getClientIp: vi.fn(() => "203.0.113.5") };
});

import { getCartId } from "@/features/cart/cart-cookie";
import { getShippingQuote } from "@/features/shipping/quote";
import { resolveStorefrontTenant } from "@/features/storefront/resolve-tenant";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { GET } from "@/app/api/shipping/quote/route";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

function request(params: Record<string, string>): NextRequest {
  const url = new URL("http://localhost:3000/api/shipping/quote");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new NextRequest(url);
}

function mockReadyTenant() {
  vi.mocked(resolveStorefrontTenant).mockResolvedValue({
    status: "ready",
    tenant: { id: TENANT_ID, slug: "loja-teste" } as never,
  });
}

describe("GET /api/shipping/quote (D15-S.2 — rate limiting)", () => {
  afterEach(() => {
    vi.mocked(resolveStorefrontTenant).mockReset();
    vi.mocked(getShippingQuote).mockReset();
    vi.mocked(getCartId).mockClear();
    vi.mocked(checkRateLimit).mockReset();
  });

  it("dentro do limite: chama getShippingQuote e devolve o resultado normalmente", async () => {
    mockReadyTenant();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 60 });
    vi.mocked(getShippingQuote).mockResolvedValue({ status: "ok", options: [] });

    const response = await GET(request({ slug: "loja-teste", zip: "01310100" }));
    const body = await response.json();

    expect(body).toEqual({ status: "ok", options: [] });
    expect(getShippingQuote).toHaveBeenCalledTimes(1);
  });

  it("chave do rate limit inclui IP e o tenant_id resolvido pelo SERVIDOR (nunca um valor de query/body)", async () => {
    mockReadyTenant();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 60 });
    vi.mocked(getShippingQuote).mockResolvedValue({ status: "ok", options: [] });

    await GET(request({ slug: "loja-teste", zip: "01310100" }));

    expect(checkRateLimit).toHaveBeenCalledWith(`shipping-quote:203.0.113.5:${TENANT_ID}`, 60, 10);
  });

  it("[D15-S.2] limite atingido: HTTP 429, Retry-After, e getShippingQuote NUNCA é chamado (nenhuma chamada ao Melhor Envio)", async () => {
    mockReadyTenant();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfterSeconds: 37 });

    const response = await GET(request({ slug: "loja-teste", zip: "01310100" }));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("37");
    expect(body).toEqual({ status: "rate_limited" });
    expect(getShippingQuote).not.toHaveBeenCalled();
  });

  it("[D15-S.2] limiter indisponível (checkRateLimit retorna null): fail-CLOSED — HTTP 503, getShippingQuote NUNCA é chamado", async () => {
    mockReadyTenant();
    vi.mocked(checkRateLimit).mockResolvedValue(null);

    const response = await GET(request({ slug: "loja-teste", zip: "01310100" }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ status: "unavailable" });
    expect(getShippingQuote).not.toHaveBeenCalled();
  });

  it("loja indisponível: nunca chega a checar rate limit nem a chamar getShippingQuote", async () => {
    vi.mocked(resolveStorefrontTenant).mockResolvedValue({ status: "not_found" });

    const response = await GET(request({ slug: "loja-inexistente", zip: "01310100" }));
    const body = await response.json();

    expect(body).toEqual({ status: "unavailable" });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(getShippingQuote).not.toHaveBeenCalled();
  });

  it("CEP inválido: nunca chega a resolver tenant, checar rate limit, ou chamar getShippingQuote", async () => {
    const response = await GET(request({ slug: "loja-teste", zip: "123" }));
    const body = await response.json();

    expect(body).toEqual({ status: "invalid_zip" });
    expect(resolveStorefrontTenant).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(getShippingQuote).not.toHaveBeenCalled();
  });

  it("slug/zip ausentes: HTTP 400, invalid_zip", async () => {
    const response = await GET(request({}));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body).toEqual({ status: "invalid_zip" });
  });
});
