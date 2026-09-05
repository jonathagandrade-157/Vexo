import { describe, expect, it } from "vitest";

import { normalizeHost } from "@/lib/security/host-normalization";

/**
 * D17.4.1 — `normalizeHost` é pura (sem I/O/DNS/banco), então testada
 * diretamente, sem mocks. Cobre exatamente a matriz de casos exigida pela
 * auditoria D17.4.0 §M e pelo ticket D17.4.1 §8.
 */
describe("normalizeHost", () => {
  it("null → null", () => {
    expect(normalizeHost(null)).toBeNull();
  });

  it("string vazia → null", () => {
    expect(normalizeHost("")).toBeNull();
  });

  it("espaços externos são removidos (trim)", () => {
    expect(normalizeHost("  example.com  ")).toBe("example.com");
  });

  it("uppercase → lowercase", () => {
    expect(normalizeHost("EXAMPLE.COM")).toBe("example.com");
  });

  it("lowercase permanece igual", () => {
    expect(normalizeHost("example.com")).toBe("example.com");
  });

  it("trailing dot único é removido", () => {
    expect(normalizeHost("example.com.")).toBe("example.com");
  });

  it("trailing dot múltiplo é removido com segurança", () => {
    expect(normalizeHost("example.com...")).toBe("example.com");
  });

  it("porta 80 é removida", () => {
    expect(normalizeHost("example.com:80")).toBe("example.com");
  });

  it("porta 443 é removida", () => {
    expect(normalizeHost("example.com:443")).toBe("example.com");
  });

  it("porta 3000 é removida", () => {
    expect(normalizeHost("example.com:3000")).toBe("example.com");
  });

  it("hostname simples", () => {
    expect(normalizeHost("example.com")).toBe("example.com");
  });

  it("subdomínio", () => {
    expect(normalizeHost("loja.example.com")).toBe("loja.example.com");
  });

  it("múltiplos níveis", () => {
    expect(normalizeHost("a.b.c.example.com.br")).toBe("a.b.c.example.com.br");
  });

  it("protocolo rejeitado", () => {
    expect(normalizeHost("https://example.com")).toBeNull();
    expect(normalizeHost("http://example.com")).toBeNull();
  });

  it("path rejeitado", () => {
    expect(normalizeHost("example.com/path")).toBeNull();
  });

  it("query rejeitada", () => {
    expect(normalizeHost("example.com?x=1")).toBeNull();
  });

  it("fragment rejeitado", () => {
    expect(normalizeHost("example.com#section")).toBeNull();
  });

  it("espaço interno rejeitado", () => {
    expect(normalizeHost("example .com")).toBeNull();
  });

  it("vírgula rejeitada (múltiplos hosts)", () => {
    expect(normalizeHost("foo,bar.com")).toBeNull();
  });

  it("credenciais rejeitadas", () => {
    expect(normalizeHost("user@example.com")).toBeNull();
    expect(normalizeHost("user:pass@example.com")).toBeNull();
  });

  it("localhost rejeitado", () => {
    expect(normalizeHost("localhost")).toBeNull();
    expect(normalizeHost("localhost:3000")).toBeNull();
  });

  it("IPv4 rejeitado", () => {
    expect(normalizeHost("127.0.0.1")).toBeNull();
    expect(normalizeHost("127.0.0.1:8080")).toBeNull();
    expect(normalizeHost("192.168.0.1")).toBeNull();
  });

  it("IPv6 rejeitado", () => {
    expect(normalizeHost("::1")).toBeNull();
    expect(normalizeHost("[::1]")).toBeNull();
    expect(normalizeHost("[::1]:8080")).toBeNull();
    expect(normalizeHost("2001:db8::1")).toBeNull();
    expect(normalizeHost("fe80::1%eth0")).toBeNull();
  });

  it("hostname acima do limite permitido (253 caracteres) → null", () => {
    const label = "a".repeat(63);
    const tooLong = `${label}.${label}.${label}.${label}.com`; // > 253 chars
    expect(tooLong.length).toBeGreaterThan(253);
    expect(normalizeHost(tooLong)).toBeNull();
  });

  it("rótulo acima de 63 caracteres → null", () => {
    const longLabel = "a".repeat(64);
    expect(normalizeHost(`${longLabel}.com`)).toBeNull();
  });

  it("labels inválidos (caracteres não permitidos) → null", () => {
    expect(normalizeHost("exa_mple.com")).toBeNull();
    expect(normalizeHost("exa!mple.com")).toBeNull();
    expect(normalizeHost("exâmple.com")).toBeNull();
  });

  it("label iniciando com hífen → null", () => {
    expect(normalizeHost("-example.com")).toBeNull();
  });

  it("label terminando com hífen → null", () => {
    expect(normalizeHost("example-.com")).toBeNull();
  });

  it("hífen no meio do rótulo é aceito", () => {
    expect(normalizeHost("minha-loja.com.br")).toBe("minha-loja.com.br");
  });

  it("hostname de um único rótulo (sem TLD) → null", () => {
    expect(normalizeHost("example")).toBeNull();
  });

  it("combinação: uppercase + porta + trailing dot", () => {
    expect(normalizeHost("EXAMPLE.COM:443.")).toBe("example.com");
  });

  it("combinação: uppercase + espaços externos + porta + trailing dot múltiplo", () => {
    expect(normalizeHost("  EXAMPLE.COM:3000..  ")).toBe("example.com");
  });

  it("TLD numérico é rejeitado (nunca bate em tenant_domains.domain)", () => {
    expect(normalizeHost("example.123")).toBeNull();
  });

  it("porta inválida (fora do range TCP) → null", () => {
    expect(normalizeHost("example.com:0")).toBeNull();
    expect(normalizeHost("example.com:70000")).toBeNull();
  });

  it("porta não numérica → null", () => {
    expect(normalizeHost("example.com:abc")).toBeNull();
  });

  it("dois-pontos duplicados (nem porta válida, nem IPv6 válido) → null", () => {
    expect(normalizeHost("example.com:443:8080")).toBeNull();
  });

  it("nunca lança para nenhum input de teste acima (garantia geral)", () => {
    const inputs = [null, "", "   ", "https://a.com/b?c#d", "a".repeat(1000), "😀.com", "\t\n"];
    for (const input of inputs) {
      expect(() => normalizeHost(input)).not.toThrow();
    }
  });
});
