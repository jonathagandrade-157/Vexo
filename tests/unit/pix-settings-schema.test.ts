import { describe, expect, it } from "vitest";
import { normalizePixKey, pixSettingsSchema } from "@/features/settings/pix-schema";

describe("pixSettingsSchema", () => {
  it("permite desabilitado sem nenhum campo preenchido", () => {
    const result = pixSettingsSchema.safeParse({ enabled: false, pixKeyType: "", pixKey: "", recipientName: "" });
    expect(result.success).toBe(true);
  });

  it("exige tipo/chave/nome quando habilitado", () => {
    const result = pixSettingsSchema.safeParse({ enabled: true, pixKeyType: "", pixKey: "", recipientName: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toEqual(expect.arrayContaining(["pixKeyType", "pixKey", "recipientName"]));
    }
  });

  it("aceita CPF/CNPJ válidos (11 ou 14 dígitos, com ou sem formatação)", () => {
    for (const key of ["12345678901", "123.456.789-01", "12345678000199", "12.345.678/0001-99"]) {
      const result = pixSettingsSchema.safeParse({ enabled: true, pixKeyType: "cpf_cnpj", pixKey: key, recipientName: "Loja" });
      expect(result.success).toBe(true);
    }
  });

  it("rejeita CPF/CNPJ com quantidade de dígitos inválida", () => {
    const result = pixSettingsSchema.safeParse({ enabled: true, pixKeyType: "cpf_cnpj", pixKey: "123", recipientName: "Loja" });
    expect(result.success).toBe(false);
  });

  it("aceita e-mail válido, rejeita inválido", () => {
    expect(
      pixSettingsSchema.safeParse({ enabled: true, pixKeyType: "email", pixKey: "loja@example.com", recipientName: "Loja" }).success,
    ).toBe(true);
    expect(
      pixSettingsSchema.safeParse({ enabled: true, pixKeyType: "email", pixKey: "não-é-email", recipientName: "Loja" }).success,
    ).toBe(false);
  });

  it("aceita telefone BR válido, rejeita inválido", () => {
    expect(
      pixSettingsSchema.safeParse({ enabled: true, pixKeyType: "phone", pixKey: "11999999999", recipientName: "Loja" }).success,
    ).toBe(true);
    expect(
      pixSettingsSchema.safeParse({ enabled: true, pixKeyType: "phone", pixKey: "123", recipientName: "Loja" }).success,
    ).toBe(false);
  });

  it("aceita chave aleatória (formato UUID), rejeita outro formato", () => {
    expect(
      pixSettingsSchema.safeParse({
        enabled: true,
        pixKeyType: "random",
        pixKey: "123e4567-e89b-12d3-a456-426614174000",
        recipientName: "Loja",
      }).success,
    ).toBe(true);
    expect(
      pixSettingsSchema.safeParse({ enabled: true, pixKeyType: "random", pixKey: "chave-qualquer", recipientName: "Loja" }).success,
    ).toBe(false);
  });
});

describe("normalizePixKey", () => {
  it("normaliza CPF/CNPJ para só dígitos", () => {
    expect(normalizePixKey("cpf_cnpj", "123.456.789-01")).toBe("12345678901");
  });

  it("normaliza telefone para o formato 55DDD9XXXXXXXX", () => {
    expect(normalizePixKey("phone", "(11) 99999-9999")).toBe("5511999999999");
  });

  it("mantém e-mail/chave aleatória como texto, só trim", () => {
    expect(normalizePixKey("email", "  loja@example.com  ")).toBe("loja@example.com");
    expect(normalizePixKey("random", "  123e4567-e89b-12d3-a456-426614174000  ")).toBe("123e4567-e89b-12d3-a456-426614174000");
  });
});
