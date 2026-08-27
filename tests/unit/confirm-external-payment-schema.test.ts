import { describe, expect, it } from "vitest";
import { confirmExternalPaymentSchema } from "@/features/orders/schema";

describe("confirmExternalPaymentSchema", () => {
  it("exige motivo não vazio", () => {
    expect(confirmExternalPaymentSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(confirmExternalPaymentSchema.safeParse({ reason: "   " }).success).toBe(false);
  });

  it("aceita um motivo válido, com trim", () => {
    const result = confirmExternalPaymentSchema.safeParse({ reason: "  comprovante conferido  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.reason).toBe("comprovante conferido");
  });

  it("rejeita motivo acima de 500 caracteres", () => {
    expect(confirmExternalPaymentSchema.safeParse({ reason: "a".repeat(501) }).success).toBe(false);
  });
});
