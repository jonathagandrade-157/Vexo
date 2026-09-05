import { describe, expect, it } from "vitest";

import { isStorefrontPath } from "@/lib/security/storefront-path-allowlist";

/**
 * D17.4.2 — `isStorefrontPath` é a allowlist explícita que decide quais
 * pathnames o Host Routing (`proxy.ts`) sequer considera para rewrite.
 * Testada isoladamente da resolução de host/tenant, cobrindo tanto os 5
 * caminhos reais de `app/loja/[slug]/` quanto todas as rotas internas que
 * NUNCA podem ser tratadas como storefront (ticket D17.4.2 Parte 3/13).
 */
describe("isStorefrontPath", () => {
  it("aceita a home", () => {
    expect(isStorefrontPath("/")).toBe(true);
  });

  it("aceita /carrinho (com e sem trailing slash)", () => {
    expect(isStorefrontPath("/carrinho")).toBe(true);
    expect(isStorefrontPath("/carrinho/")).toBe(true);
  });

  it("aceita /checkout (com e sem trailing slash)", () => {
    expect(isStorefrontPath("/checkout")).toBe(true);
    expect(isStorefrontPath("/checkout/")).toBe(true);
  });

  it("aceita /produto/<slug>", () => {
    expect(isStorefrontPath("/produto/camiseta")).toBe(true);
    expect(isStorefrontPath("/produto/camiseta-azul-123")).toBe(true);
  });

  it("rejeita /produto sem slug (rota não existe em app/loja/[slug]/produto)", () => {
    expect(isStorefrontPath("/produto")).toBe(false);
    expect(isStorefrontPath("/produto/")).toBe(false);
  });

  it("aceita /pedido/<orderId>", () => {
    expect(isStorefrontPath("/pedido/abc123")).toBe(true);
  });

  it("rejeita /pedido sem orderId", () => {
    expect(isStorefrontPath("/pedido")).toBe(false);
    expect(isStorefrontPath("/pedido/")).toBe(false);
  });

  it.each([
    "/painel",
    "/painel/configuracoes",
    "/painel/configuracoes/dominio",
    "/master",
    "/master/lojas",
    "/api/health",
    "/api/webhooks/mercadopago",
    "/login",
    "/cadastro",
    "/recuperar-senha",
    "/redefinir-senha",
    "/onboarding",
    "/onboarding/loja",
    "/sem-loja",
    "/painel-preview/aparencia",
    "/_next/static/chunk.js",
    "/_next/data/build/loja.json",
    "/favicon.ico",
    "/robots.txt",
    "/sitemap.xml",
  ])("nunca trata %s como storefront", (pathname) => {
    expect(isStorefrontPath(pathname)).toBe(false);
  });

  it("nunca trata um pathname já reescrito para /loja/... como elegível de novo", () => {
    expect(isStorefrontPath("/loja/minha-loja")).toBe(false);
    expect(isStorefrontPath("/loja/minha-loja/carrinho")).toBe(false);
  });

  it("rejeita paths que só parecem storefront (prefixo/sufixo)", () => {
    expect(isStorefrontPath("/carrinho-falso")).toBe(false);
    expect(isStorefrontPath("/checkoutextra")).toBe(false);
    expect(isStorefrontPath("/produto/camiseta/extra")).toBe(false);
  });
});
