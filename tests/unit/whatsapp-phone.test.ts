import { describe, expect, it } from "vitest";
import { normalizeBrazilianPhone } from "@/lib/whatsapp/phone";

describe("normalizeBrazilianPhone", () => {
  it("normaliza 11 dígitos (DDD + celular, sem DDI)", () => {
    expect(normalizeBrazilianPhone("11999999999")).toBe("5511999999999");
  });

  it("normaliza 10 dígitos (DDD + fixo, sem DDI)", () => {
    expect(normalizeBrazilianPhone("1133334444")).toBe("551133334444");
  });

  it("normaliza 13 dígitos (já com 55 + celular)", () => {
    expect(normalizeBrazilianPhone("5511999999999")).toBe("5511999999999");
  });

  it("normaliza 12 dígitos (já com 55 + fixo)", () => {
    expect(normalizeBrazilianPhone("551133334444")).toBe("551133334444");
  });

  it("remove formatação (parênteses, espaço, hífen) antes de normalizar", () => {
    expect(normalizeBrazilianPhone("(11) 99999-9999")).toBe("5511999999999");
  });

  it("rejeita DDD inexistente", () => {
    expect(normalizeBrazilianPhone("00999999999")).toBeNull();
    expect(normalizeBrazilianPhone("10999999999")).toBeNull();
  });

  it("rejeita celular de 9 dígitos que não começa com 9", () => {
    expect(normalizeBrazilianPhone("11899999999")).toBeNull();
  });

  it("rejeita comprimento inválido (nem 10/11/12/13 dígitos)", () => {
    expect(normalizeBrazilianPhone("119999999")).toBeNull();
    expect(normalizeBrazilianPhone("119999999999999")).toBeNull();
    expect(normalizeBrazilianPhone("")).toBeNull();
  });

  it("rejeita 12/13 dígitos que não começam com 55 (DDI diferente, não suportado)", () => {
    expect(normalizeBrazilianPhone("1234567890123")).toBeNull();
  });
});
