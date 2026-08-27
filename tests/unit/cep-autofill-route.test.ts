import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/address/cep-lookup", () => ({ lookupCep: vi.fn() }));

import { lookupCep } from "@/lib/address/cep-lookup";
import { GET } from "@/app/api/address/cep/route";

/**
 * D3.2-A — autofill de endereço no checkout. Testa só o que este Route
 * Handler faz por conta própria (validação de formato + moldar a
 * resposta) — `lookupCep` já é testado exaustivamente em
 * tests/unit/cep-lookup.test.ts (CEP inválido, inexistente, erro HTTP,
 * timeout, resposta incompleta) e é mockado aqui para não duplicar essa
 * cobertura. Nunca importa a BrasilAPI de verdade — nenhuma chamada de
 * rede acontece neste arquivo.
 */
function request(cep: string | null): NextRequest {
  const url = cep === null ? "http://localhost/api/address/cep" : `http://localhost/api/address/cep?cep=${encodeURIComponent(cep)}`;
  return new NextRequest(url);
}

describe("GET /api/address/cep (D3.2-A)", () => {
  afterEach(() => {
    vi.mocked(lookupCep).mockReset();
  });

  it("CEP válido e encontrado: devolve status ok com os 4 campos de endereço", async () => {
    vi.mocked(lookupCep).mockResolvedValue({ street: "Rua Santo Adriano", neighborhood: "Jardim Peri", city: "São Paulo", state: "SP" });

    const response = await GET(request("02634000"));
    const body = await response.json();

    expect(body).toEqual({ status: "ok", street: "Rua Santo Adriano", neighborhood: "Jardim Peri", city: "São Paulo", state: "SP" });
    expect(lookupCep).toHaveBeenCalledWith("02634000");
  });

  it("aceita CEP formatado (com máscara) e normaliza antes de consultar", async () => {
    vi.mocked(lookupCep).mockResolvedValue({ street: "Rua X", neighborhood: "Bairro Y", city: "Cidade Z", state: "RJ" });

    await GET(request("02634-000"));

    expect(lookupCep).toHaveBeenCalledWith("02634000");
  });

  it("CEP com formato inválido (menos de 8 dígitos): status invalid_cep, nunca chega a consultar", async () => {
    const response = await GET(request("123"));
    const body = await response.json();

    expect(body).toEqual({ status: "invalid_cep" });
    expect(lookupCep).not.toHaveBeenCalled();
  });

  it("parâmetro cep ausente: status invalid_cep (HTTP 400), nunca chega a consultar", async () => {
    const response = await GET(request(null));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ status: "invalid_cep" });
    expect(lookupCep).not.toHaveBeenCalled();
  });

  it("CEP inexistente (lookupCep retorna null): status not_found, nunca lança erro", async () => {
    vi.mocked(lookupCep).mockResolvedValue(null);

    const response = await GET(request("99999999"));
    const body = await response.json();

    expect(body).toEqual({ status: "not_found" });
  });

  it("BrasilAPI indisponível/erro (lookupCep retorna null, nunca lança): status not_found, resposta amigável, sem stack trace", async () => {
    vi.mocked(lookupCep).mockResolvedValue(null);

    const response = await GET(request("01310100"));
    const body = await response.json();

    expect(response.ok).toBe(true);
    expect(body).toEqual({ status: "not_found" });
    expect(JSON.stringify(body)).not.toMatch(/error|stack|Exception/i);
  });

  it("timeout na BrasilAPI (lookupCep retorna null, nunca lança): status not_found, checkout nunca quebra", async () => {
    vi.mocked(lookupCep).mockResolvedValue(null);

    const response = await GET(request("20000000"));
    const body = await response.json();

    expect(response.ok).toBe(true);
    expect(body).toEqual({ status: "not_found" });
  });

  it("resposta incompleta da BrasilAPI (lookupCep já preenche campos vazios): repassa exatamente o que lookupCep devolveu, sem inventar dado", async () => {
    vi.mocked(lookupCep).mockResolvedValue({ street: "", neighborhood: "", city: "Rio de Janeiro", state: "RJ" });

    const response = await GET(request("20000000"));
    const body = await response.json();

    expect(body).toEqual({ status: "ok", street: "", neighborhood: "", city: "Rio de Janeiro", state: "RJ" });
  });

  it("nunca envia mais do que o CEP para lookupCep — nenhum dado adicional do cliente é repassado", async () => {
    vi.mocked(lookupCep).mockResolvedValue({ street: "A", neighborhood: "B", city: "C", state: "SP" });

    await GET(request("01310100"));

    expect(lookupCep).toHaveBeenCalledTimes(1);
    expect(lookupCep).toHaveBeenCalledWith("01310100");
  });
});
