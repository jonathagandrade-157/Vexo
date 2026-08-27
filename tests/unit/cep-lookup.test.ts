import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupCep } from "@/lib/address/cep-lookup";

describe("lookupCep", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retorna null para CEP com formato inválido, sem chegar a chamar a API", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await lookupCep("123");
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("normaliza o CEP formatado antes de chamar a API", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ cep: "01001000", state: "SP", city: "São Paulo", neighborhood: "Sé", street: "Praça da Sé" }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const result = await lookupCep("01001-000");
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("01001000"), expect.anything());
    expect(result).toEqual({ street: "Praça da Sé", neighborhood: "Sé", city: "São Paulo", state: "SP" });
  });

  it("retorna null quando a API responde com erro HTTP", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    const result = await lookupCep("00000000");
    expect(result).toBeNull();
  });

  it("retorna null quando a resposta não tem cidade/estado (CEP inexistente)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const result = await lookupCep("99999999");
    expect(result).toBeNull();
  });

  it("retorna null (nunca lança) quando a chamada falha/dá timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.reject(new DOMException("aborted", "AbortError"))),
    );
    const result = await lookupCep("01001000");
    expect(result).toBeNull();
  });

  it("preenche street/neighborhood vazios quando a API não devolve esses campos", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ state: "RJ", city: "Rio de Janeiro" }) }));
    const result = await lookupCep("20000000");
    expect(result).toEqual({ street: "", neighborhood: "", city: "Rio de Janeiro", state: "RJ" });
  });
});
