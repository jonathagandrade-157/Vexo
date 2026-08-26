import { describe, expect, it } from "vitest";
import { storeAppearanceSchema, HEX_COLOR_PATTERN, STOREFRONT_TEMPLATES } from "@/features/settings/appearance-schema";

/**
 * Sprint 1 — Fase A. Cobre a única lógica pura desta fase que roda no
 * servidor: validação de cor (nunca aceitar CSS arbitrário, só
 * `#RRGGBB`) e do modelo visual escolhido.
 */
describe("storeAppearanceSchema", () => {
  it("aceita cores válidas em #RRGGBB e um modelo válido", () => {
    const result = storeAppearanceSchema.safeParse({
      primaryColor: "#7C3AED",
      secondaryColor: "#3b82f6",
      storefrontTemplate: "commerce",
    });
    expect(result.success).toBe(true);
  });

  it("trata campo de cor vazio como 'não personalizado' (null), nunca como erro", () => {
    const result = storeAppearanceSchema.safeParse({
      primaryColor: "",
      secondaryColor: "",
      storefrontTemplate: "commerce",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.primaryColor).toBeNull();
      expect(result.data.secondaryColor).toBeNull();
    }
  });

  it("rejeita cor sem o formato #RRGGBB", () => {
    for (const invalid of ["7C3AED", "#7C3", "#GGGGGG", "red", "rgb(0,0,0)"]) {
      const result = storeAppearanceSchema.safeParse({
        primaryColor: invalid,
        secondaryColor: "#000000",
        storefrontTemplate: "commerce",
      });
      expect(result.success).toBe(false);
    }
  });

  it("nunca aceita CSS arbitrário (injeção via url()/expression()) como cor", () => {
    for (const malicious of ["url(javascript:alert(1))", "expression(alert(1))", "#000000; background: url(x)"]) {
      const result = storeAppearanceSchema.safeParse({
        primaryColor: malicious,
        secondaryColor: "#000000",
        storefrontTemplate: "commerce",
      });
      expect(result.success).toBe(false);
    }
  });

  it("rejeita um storefrontTemplate fora da lista fechada", () => {
    const result = storeAppearanceSchema.safeParse({
      primaryColor: "#000000",
      secondaryColor: "#ffffff",
      storefrontTemplate: "not-a-real-template",
    });
    expect(result.success).toBe(false);
  });

  it("os 5 modelos da Sprint 1 são exatamente os esperados, nenhum a mais (lookbook/blog/coleções)", () => {
    expect(STOREFRONT_TEMPLATES).toEqual(["commerce", "premium", "minimal", "editorial", "fashion"]);
  });
});

describe("HEX_COLOR_PATTERN", () => {
  it("aceita maiúsculas e minúsculas", () => {
    expect(HEX_COLOR_PATTERN.test("#AbC123")).toBe(true);
  });
  it("rejeita com espaço/caracteres extras", () => {
    expect(HEX_COLOR_PATTERN.test("#AbC123 ")).toBe(false);
    expect(HEX_COLOR_PATTERN.test("##AbC123")).toBe(false);
  });
});
