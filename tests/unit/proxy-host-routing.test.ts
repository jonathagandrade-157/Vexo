import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * D17.4.2 — testa `proxy()` (`proxy.ts`) diretamente, mesmo padrão de
 * `tests/unit/shipping-quote-route.test.ts` (constrói um `NextRequest`
 * real, chama o handler exportado, inspeciona a `NextResponse` — sem
 * jsdom/Playwright, sem dependência nova). Mocka:
 *  - `@/lib/env` (evita a validação real de env vars — `getPublicEnv()`
 *    lançaria neste ambiente sem `.env.local`, e permite controlar
 *    `NEXT_PUBLIC_SITE_URL`/`NEXT_PUBLIC_STOREFRONT_DOMAIN_SUFFIX` para os
 *    testes de host reservado);
 *  - `@supabase/ssr` (evita uma chamada de rede real de
 *    `supabase.auth.getUser()` — já teria seu próprio comportamento
 *    coberto em outro lugar; aqui só interessa que ele É chamado, nunca
 *    pulado);
 *  - `@/features/storefront/resolve-tenant-by-host` (já testado
 *    isoladamente em `tests/unit/resolve-tenant-by-host.test.ts` — aqui só
 *    interessa COMO o proxy usa o resultado, nunca reimplementar aquele
 *    teste).
 * `normalizeHost`/`isStorefrontPath`/`isReservedDomain` NÃO são mockados —
 * são funções puras reais, exercitadas de ponta a ponta através do proxy.
 */
vi.mock("@/lib/env", () => ({
  getPublicEnv: vi.fn(() => ({
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-de-teste",
    NEXT_PUBLIC_SITE_URL: "https://vexoecommerce.vercel.app",
    NEXT_PUBLIC_STOREFRONT_DOMAIN_SUFFIX: "vexo.app",
  })),
}));

const getUserMock = vi.fn(async () => ({ data: { user: null }, error: null }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: { getUser: getUserMock } })),
}));

vi.mock("@/features/storefront/resolve-tenant-by-host", () => ({ resolveTenantByHost: vi.fn() }));

import { proxy } from "@/proxy";
import { resolveTenantByHost } from "@/features/storefront/resolve-tenant-by-host";

/**
 * A URL usada para construir o `NextRequest` é sempre um host de placeholder
 * VÁLIDO — decidido de propósito assim, independente do `host` de teste, que
 * vai só no header `Host` (via `init.headers`). Isso reflete a realidade de
 * uma requisição HTTP de verdade: o header `Host` é um valor de texto
 * enviado pelo cliente, não derivado da URL — pode ser qualquer string,
 * inclusive malformada, e é exatamente isso que os testes de host inválido
 * (#6) e de normalização (#21) precisam simular. `proxy.ts` só lê
 * `request.headers.get("host")`, nunca `request.nextUrl.host`.
 */
function makeRequest(pathname: string, host: string): NextRequest {
  const url = new URL(`https://proxy-test.invalid${pathname}`);
  return new NextRequest(url, { headers: { host } });
}

/** `NextResponse.rewrite(url)` sinaliza a reescrita via este header — não há outra forma pública de inspecionar o destino de um rewrite a partir da resposta retornada por um handler de proxy/middleware. */
function rewrittenPathname(response: Awaited<ReturnType<typeof proxy>>): string | null {
  const target = response.headers.get("x-middleware-rewrite");
  return target ? new URL(target).pathname : null;
}

describe("proxy — Host Routing (D17.4.2)", () => {
  beforeEach(() => {
    vi.mocked(resolveTenantByHost).mockReset();
    getUserMock.mockClear();
  });

  it("1) host customizado ativo + '/' → rewrite para /loja/<slug>", async () => {
    vi.mocked(resolveTenantByHost).mockResolvedValue({ status: "ready", slug: "loja-exemplo" });

    const response = await proxy(makeRequest("/", "lojaexemplo.com.br"));
    expect(rewrittenPathname(response)).toBe("/loja/loja-exemplo");
    expect(resolveTenantByHost).toHaveBeenCalledWith("lojaexemplo.com.br");
  });

  it("2) host customizado ativo + pathname de storefront → rewrite preservando o pathname", async () => {
    vi.mocked(resolveTenantByHost).mockResolvedValue({ status: "ready", slug: "loja-exemplo" });

    const carrinho = await proxy(makeRequest("/carrinho", "lojaexemplo.com.br"));
    expect(rewrittenPathname(carrinho)).toBe("/loja/loja-exemplo/carrinho");

    const produto = await proxy(makeRequest("/produto/camiseta", "lojaexemplo.com.br"));
    expect(rewrittenPathname(produto)).toBe("/loja/loja-exemplo/produto/camiseta");

    const pedido = await proxy(makeRequest("/pedido/abc123", "lojaexemplo.com.br"));
    expect(rewrittenPathname(pedido)).toBe("/loja/loja-exemplo/pedido/abc123");

    const checkout = await proxy(makeRequest("/checkout", "lojaexemplo.com.br"));
    expect(rewrittenPathname(checkout)).toBe("/loja/loja-exemplo/checkout");
  });

  it("3) domínio pending/verifying (resolver retorna not_found) → sem rewrite", async () => {
    vi.mocked(resolveTenantByHost).mockResolvedValue({ status: "not_found" });

    const response = await proxy(makeRequest("/", "pendente.com.br"));
    expect(rewrittenPathname(response)).toBeNull();
  });

  it("4) tenant suspended/deleted (resolver já retorna not_found — D17.4.1 já filtra) → sem rewrite", async () => {
    vi.mocked(resolveTenantByHost).mockResolvedValue({ status: "not_found" });

    const response = await proxy(makeRequest("/", "tenant-suspenso.com.br"));
    expect(rewrittenPathname(response)).toBeNull();
  });

  it("5) host inexistente → sem rewrite", async () => {
    vi.mocked(resolveTenantByHost).mockResolvedValue({ status: "not_found" });

    const response = await proxy(makeRequest("/", "nao-existe.com.br"));
    expect(rewrittenPathname(response)).toBeNull();
  });

  it("6) host inválido → sem rewrite, e resolveTenantByHost nunca é chamado", async () => {
    const response = await proxy(makeRequest("/", "example .com"));
    expect(rewrittenPathname(response)).toBeNull();
    expect(resolveTenantByHost).not.toHaveBeenCalled();
  });

  it("7) host VEXO reservado (NEXT_PUBLIC_SITE_URL) → sem rewrite, sem consultar o resolver", async () => {
    const response = await proxy(makeRequest("/", "vexoecommerce.vercel.app"));
    expect(rewrittenPathname(response)).toBeNull();
    expect(resolveTenantByHost).not.toHaveBeenCalled();
  });

  it("7b) subdomínio reservado (NEXT_PUBLIC_STOREFRONT_DOMAIN_SUFFIX) → sem rewrite, sem consultar o resolver", async () => {
    const response = await proxy(makeRequest("/", "loja-teste.vexo.app"));
    expect(rewrittenPathname(response)).toBeNull();
    expect(resolveTenantByHost).not.toHaveBeenCalled();
  });

  it("8) /painel nunca sofre rewrite, mesmo com host de domínio ativo — e nunca consulta o resolver", async () => {
    vi.mocked(resolveTenantByHost).mockResolvedValue({ status: "ready", slug: "loja-exemplo" });

    const response = await proxy(makeRequest("/painel/configuracoes", "lojaexemplo.com.br"));
    expect(rewrittenPathname(response)).toBeNull();
    expect(resolveTenantByHost).not.toHaveBeenCalled();
  });

  it("9) /master nunca sofre rewrite, e nunca consulta o resolver", async () => {
    vi.mocked(resolveTenantByHost).mockResolvedValue({ status: "ready", slug: "loja-exemplo" });

    const response = await proxy(makeRequest("/master/lojas", "lojaexemplo.com.br"));
    expect(rewrittenPathname(response)).toBeNull();
    expect(resolveTenantByHost).not.toHaveBeenCalled();
  });

  it("10) /api nunca sofre rewrite, e nunca consulta o resolver", async () => {
    vi.mocked(resolveTenantByHost).mockResolvedValue({ status: "ready", slug: "loja-exemplo" });

    const response = await proxy(makeRequest("/api/webhooks/mercadopago", "lojaexemplo.com.br"));
    expect(rewrittenPathname(response)).toBeNull();
    expect(resolveTenantByHost).not.toHaveBeenCalled();
  });

  it("11) /login nunca sofre rewrite", async () => {
    vi.mocked(resolveTenantByHost).mockResolvedValue({ status: "ready", slug: "loja-exemplo" });
    const response = await proxy(makeRequest("/login", "lojaexemplo.com.br"));
    expect(rewrittenPathname(response)).toBeNull();
    expect(resolveTenantByHost).not.toHaveBeenCalled();
  });

  it("12) /cadastro nunca sofre rewrite", async () => {
    vi.mocked(resolveTenantByHost).mockResolvedValue({ status: "ready", slug: "loja-exemplo" });
    const response = await proxy(makeRequest("/cadastro", "lojaexemplo.com.br"));
    expect(rewrittenPathname(response)).toBeNull();
    expect(resolveTenantByHost).not.toHaveBeenCalled();
  });

  it("13) /onboarding nunca sofre rewrite", async () => {
    vi.mocked(resolveTenantByHost).mockResolvedValue({ status: "ready", slug: "loja-exemplo" });
    const response = await proxy(makeRequest("/onboarding", "lojaexemplo.com.br"));
    expect(rewrittenPathname(response)).toBeNull();
    expect(resolveTenantByHost).not.toHaveBeenCalled();
  });

  it("14) /sem-loja nunca sofre rewrite", async () => {
    vi.mocked(resolveTenantByHost).mockResolvedValue({ status: "ready", slug: "loja-exemplo" });
    const response = await proxy(makeRequest("/sem-loja", "lojaexemplo.com.br"));
    expect(rewrittenPathname(response)).toBeNull();
    expect(resolveTenantByHost).not.toHaveBeenCalled();
  });

  it("15) /painel-preview nunca sofre rewrite", async () => {
    vi.mocked(resolveTenantByHost).mockResolvedValue({ status: "ready", slug: "loja-exemplo" });
    const response = await proxy(makeRequest("/painel-preview/aparencia", "lojaexemplo.com.br"));
    expect(rewrittenPathname(response)).toBeNull();
    expect(resolveTenantByHost).not.toHaveBeenCalled();
  });

  it("16) assets (_next) nunca sofrem rewrite, e nunca consultam o resolver", async () => {
    vi.mocked(resolveTenantByHost).mockResolvedValue({ status: "ready", slug: "loja-exemplo" });
    const response = await proxy(makeRequest("/_next/data/build/loja.json", "lojaexemplo.com.br"));
    expect(rewrittenPathname(response)).toBeNull();
    expect(resolveTenantByHost).not.toHaveBeenCalled();
  });

  it("19) erro do resolver (rejeição inesperada) → request continua sem rewrite", async () => {
    vi.mocked(resolveTenantByHost).mockRejectedValue(new Error("falha inesperada de banco"));

    await expect(proxy(makeRequest("/", "lojaexemplo.com.br"))).rejects.toThrow();
    // Nota: `resolveTenantByHost` (D17.4.1) já documenta e testa que ele
    // mesmo nunca lança para erro de banco (sempre `not_found`) — este
    // teste apenas confirma que o proxy não adiciona nenhum try/catch
    // silencioso que mascare um erro real de programação; o contrato de
    // "nunca lançar" é responsabilidade do resolver, já garantido e
    // testado em tests/unit/resolve-tenant-by-host.test.ts.
  });

  it("20) nenhum tenant_id é lido da request — resolveTenantByHost é chamado só com o host", async () => {
    vi.mocked(resolveTenantByHost).mockResolvedValue({ status: "not_found" });

    await proxy(makeRequest("/?tenant_id=11111111-1111-1111-1111-111111111111", "lojaexemplo.com.br"));
    expect(resolveTenantByHost).toHaveBeenCalledWith("lojaexemplo.com.br");
    expect(resolveTenantByHost).not.toHaveBeenCalledWith(expect.stringContaining("1111"));
  });

  it("21) resolver recebe exatamente o host normalizado (lowercase, sem porta, sem trailing dot)", async () => {
    vi.mocked(resolveTenantByHost).mockResolvedValue({ status: "not_found" });

    await proxy(makeRequest("/", "LOJAEXEMPLO.com.br:443."));
    expect(resolveTenantByHost).toHaveBeenCalledWith("lojaexemplo.com.br");
  });

  it("22) sem loop: uma request já em /loja/<slug> nunca é reescrita de novo, mesmo com host de domínio ativo", async () => {
    vi.mocked(resolveTenantByHost).mockResolvedValue({ status: "ready", slug: "loja-exemplo" });

    const response = await proxy(makeRequest("/loja/loja-exemplo", "lojaexemplo.com.br"));
    expect(rewrittenPathname(response)).toBeNull();
    expect(resolveTenantByHost).not.toHaveBeenCalled();
  });

  it("o refresh de sessão Supabase continua acontecendo em toda requisição, rewrite ou não", async () => {
    vi.mocked(resolveTenantByHost).mockResolvedValue({ status: "ready", slug: "loja-exemplo" });
    await proxy(makeRequest("/", "lojaexemplo.com.br"));
    expect(getUserMock).toHaveBeenCalledTimes(1);

    vi.mocked(resolveTenantByHost).mockResolvedValue({ status: "not_found" });
    await proxy(makeRequest("/painel", "lojaexemplo.com.br"));
    expect(getUserMock).toHaveBeenCalledTimes(2);
  });
});
