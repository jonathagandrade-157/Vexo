import { describe, expect, it } from "vitest";
import { CHECKOUT_MODES, checkoutModeSchema, isCheckoutMode } from "@/features/settings/checkout-schema";

/**
 * Fase D1. Cobre a única lógica pura desta fase: validação do modo de
 * recebimento de pedidos e o type guard usado para ler o valor cru do
 * banco com segurança.
 */
describe("checkoutModeSchema", () => {
  it("aceita os 3 valores válidos: vexo, whatsapp, both", () => {
    for (const mode of CHECKOUT_MODES) {
      const result = checkoutModeSchema.safeParse({ checkoutMode: mode });
      expect(result.success).toBe(true);
    }
  });

  it("rejeita um valor fora dos 3 modos definidos", () => {
    for (const invalid of ["", "pix", "manual", "VEXO", "Whatsapp", null, undefined]) {
      const result = checkoutModeSchema.safeParse({ checkoutMode: invalid });
      expect(result.success).toBe(false);
    }
  });

  it("os 3 modos são exatamente os pedidos, nenhum a mais", () => {
    expect(CHECKOUT_MODES).toEqual(["vexo", "whatsapp", "both"]);
  });
});

describe("isCheckoutMode", () => {
  it("reconhece os 3 valores válidos", () => {
    expect(isCheckoutMode("vexo")).toBe(true);
    expect(isCheckoutMode("whatsapp")).toBe(true);
    expect(isCheckoutMode("both")).toBe(true);
  });

  it("rejeita valores inválidos, incluindo null/undefined/tipos não-string", () => {
    expect(isCheckoutMode("pix")).toBe(false);
    expect(isCheckoutMode(null)).toBe(false);
    expect(isCheckoutMode(undefined)).toBe(false);
    expect(isCheckoutMode(123)).toBe(false);
  });
});
