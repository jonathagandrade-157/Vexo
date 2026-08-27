import { describe, expect, it } from "vitest";
import { whatsappSettingsSchema } from "@/features/settings/whatsapp-schema";

describe("whatsappSettingsSchema", () => {
  it("aceita um número válido sem formatação e normaliza para 55DDD9XXXXXXXX", () => {
    const result = whatsappSettingsSchema.safeParse({ whatsappPhone: "11999999999" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.whatsappPhone).toBe("5511999999999");
  });

  it("aceita um número formatado (parênteses/espaço/hífen) e normaliza igual", () => {
    const result = whatsappSettingsSchema.safeParse({ whatsappPhone: "(11) 99999-9999" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.whatsappPhone).toBe("5511999999999");
  });

  it("aceita um número já com DDI (55) e mantém normalizado", () => {
    const result = whatsappSettingsSchema.safeParse({ whatsappPhone: "5511999999999" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.whatsappPhone).toBe("5511999999999");
  });

  it("aceita um fixo (10 dígitos, sem DDI)", () => {
    const result = whatsappSettingsSchema.safeParse({ whatsappPhone: "1133334444" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.whatsappPhone).toBe("551133334444");
  });

  it("rejeita DDD inexistente", () => {
    const result = whatsappSettingsSchema.safeParse({ whatsappPhone: "00999999999" });
    expect(result.success).toBe(false);
  });

  it("rejeita quantidade de dígitos inválida", () => {
    for (const invalid of ["119999999", "119999999999999"]) {
      const result = whatsappSettingsSchema.safeParse({ whatsappPhone: invalid });
      expect(result.success).toBe(false);
    }
  });

  it("rejeita número malformado (celular de 9 dígitos que não começa em 9)", () => {
    const result = whatsappSettingsSchema.safeParse({ whatsappPhone: "11899999999" });
    expect(result.success).toBe(false);
  });

  it("rejeita string vazia", () => {
    const result = whatsappSettingsSchema.safeParse({ whatsappPhone: "" });
    expect(result.success).toBe(false);
  });

  it("rejeita texto que não é telefone", () => {
    const result = whatsappSettingsSchema.safeParse({ whatsappPhone: "não é um telefone" });
    expect(result.success).toBe(false);
  });

  it("o valor de saída é sempre o normalizado, nunca o texto bruto digitado", () => {
    const result = whatsappSettingsSchema.safeParse({ whatsappPhone: "  (11) 99999-9999  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.whatsappPhone).not.toContain("(");
      expect(result.data.whatsappPhone).not.toContain(" ");
      expect(result.data.whatsappPhone).toBe("5511999999999");
    }
  });
});
