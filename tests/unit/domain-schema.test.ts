import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { customDomainSchema } from "@/features/settings/domain-schema";

describe("customDomainSchema", () => {
  it("aceita um domínio válido e normaliza para lowercase", () => {
    const result = customDomainSchema.safeParse({ domain: "MinhaLoja.COM.BR" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.domain).toBe("minhaloja.com.br");
  });

  it("remove espaços nas pontas (trim)", () => {
    const result = customDomainSchema.safeParse({ domain: "  minhaloja.com.br  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.domain).toBe("minhaloja.com.br");
  });

  it("rejeita domínio vazio", () => {
    const result = customDomainSchema.safeParse({ domain: "" });
    expect(result.success).toBe(false);
  });

  it("rejeita domínio só com espaços", () => {
    const result = customDomainSchema.safeParse({ domain: "   " });
    expect(result.success).toBe(false);
  });

  it("rejeita valores com protocolo/caminho/query/fragment/espaço interno", () => {
    for (const invalid of [
      "https://minhaloja.com.br",
      "http://minhaloja.com.br",
      "minhaloja.com.br/produtos",
      "minhaloja.com.br?ref=x",
      "minhaloja.com.br#topo",
      "minha loja.com.br",
      "minhaloja",
      "-minhaloja.com.br",
      "minhaloja-.com.br",
      "minhaloja..com.br",
    ]) {
      const result = customDomainSchema.safeParse({ domain: invalid });
      expect(result.success, `esperava rejeitar "${invalid}"`).toBe(false);
    }
  });

  it("rejeita domínio maior que 253 caracteres", () => {
    const tooLong = `${"a".repeat(250)}.com`;
    const result = customDomainSchema.safeParse({ domain: tooLong });
    expect(result.success).toBe(false);
  });

  it("o valor de saída é sempre o normalizado, nunca o texto bruto digitado", () => {
    const result = customDomainSchema.safeParse({ domain: "  Www.Minha-Loja.COM  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.domain).toBe("www.minha-loja.com");
  });

  it("nunca aceita campos além de domain — tenant_id/status/domain_type/is_primary não podem ser injetados pelo cliente", () => {
    const result = customDomainSchema.safeParse({
      domain: "minhaloja.com.br",
      tenantId: "11111111-1111-1111-1111-111111111111",
      status: "active",
      domainType: "custom",
      isPrimary: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data)).toEqual(["domain"]);
    }
  });
});

describe("isReservedDomain", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    Object.assign(process.env, {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      NEXT_PUBLIC_SITE_URL: "https://vexoecommerce.vercel.app",
      NEXT_PUBLIC_STOREFRONT_DOMAIN_SUFFIX: "vexo.app",
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejeita o próprio domínio configurado em NEXT_PUBLIC_SITE_URL", async () => {
    const { isReservedDomain } = await import("@/features/settings/domain-schema");
    expect(isReservedDomain("vexoecommerce.vercel.app")).toBe(true);
  });

  it("rejeita o sufixo configurado em NEXT_PUBLIC_STOREFRONT_DOMAIN_SUFFIX", async () => {
    const { isReservedDomain } = await import("@/features/settings/domain-schema");
    expect(isReservedDomain("vexo.app")).toBe(true);
  });

  it("rejeita qualquer subdomínio do sufixo reservado", async () => {
    const { isReservedDomain } = await import("@/features/settings/domain-schema");
    expect(isReservedDomain("loja-do-cliente.vexo.app")).toBe(true);
  });

  it("aceita um domínio de terceiro, não relacionado à VEXO", async () => {
    const { isReservedDomain } = await import("@/features/settings/domain-schema");
    expect(isReservedDomain("minhaloja.com.br")).toBe(false);
  });

  it("não trata um domínio que só termina com as mesmas letras do sufixo (sem ser subdomínio de fato) como reservado", async () => {
    const { isReservedDomain } = await import("@/features/settings/domain-schema");
    // "outravexo.app" não é "vexo.app" nem termina em ".vexo.app".
    expect(isReservedDomain("outravexo.app")).toBe(false);
  });
});
