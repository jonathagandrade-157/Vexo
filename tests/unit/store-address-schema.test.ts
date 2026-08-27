import { describe, expect, it } from "vitest";
import { storeAddressSchema } from "@/features/settings/address-schema";

describe("storeAddressSchema", () => {
  it("permite endereço totalmente vazio (nenhum campo obrigatório nesta fase)", () => {
    const result = storeAddressSchema.safeParse({
      zip: "",
      street: "",
      number: "",
      complement: "",
      neighborhood: "",
      city: "",
      state: "",
    });
    expect(result.success).toBe(true);
  });

  it("permite endereço incompleto (só alguns campos preenchidos)", () => {
    const result = storeAddressSchema.safeParse({ zip: "01001000", city: "São Paulo" });
    expect(result.success).toBe(true);
  });

  it("aceita CEP válido, com ou sem formatação, e normaliza para só dígitos", () => {
    for (const zip of ["01001000", "01001-000"]) {
      const result = storeAddressSchema.safeParse({ zip });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.zip).toBe("01001000");
    }
  });

  it("rejeita CEP com quantidade de dígitos inválida", () => {
    const result = storeAddressSchema.safeParse({ zip: "123" });
    expect(result.success).toBe(false);
  });

  it("mantém a cidade com acentos, sem nenhuma normalização", () => {
    const result = storeAddressSchema.safeParse({ city: "São Paulo" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.city).toBe("São Paulo");
  });

  it("aceita estado dentro da lista de UFs reais, rejeita fora dela", () => {
    expect(storeAddressSchema.safeParse({ state: "SP" }).success).toBe(true);
    expect(storeAddressSchema.safeParse({ state: "XX" }).success).toBe(false);
  });

  it("rejeita campos de texto acima do tamanho máximo", () => {
    expect(storeAddressSchema.safeParse({ street: "a".repeat(201) }).success).toBe(false);
    expect(storeAddressSchema.safeParse({ city: "a".repeat(101) }).success).toBe(false);
  });

  it("número e complemento nunca são normalizados/transformados, só validados por tamanho", () => {
    const result = storeAddressSchema.safeParse({ number: "123A", complement: "Sala 4" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.number).toBe("123A");
      expect(result.data.complement).toBe("Sala 4");
    }
  });
});
