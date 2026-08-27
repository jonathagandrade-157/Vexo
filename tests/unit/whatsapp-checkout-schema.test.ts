import { describe, expect, it } from "vitest";
import { whatsappCheckoutSchema } from "@/features/checkout/whatsapp-schema";

const baseFields = {
  customerName: "Maria Cliente",
  customerEmail: "maria@example.com",
  customerPhone: "11912345678",
  zip: "01310100",
  street: "Av. Paulista",
  number: "1000",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
};

describe("whatsappCheckoutSchema — forma de pagamento", () => {
  it("aceita exatamente os 3 métodos válidos: pix, cash, card", () => {
    for (const method of ["pix", "cash", "card"]) {
      const result = whatsappCheckoutSchema.safeParse({ ...baseFields, paymentPreference: method });
      expect(result.success).toBe(true);
    }
  });

  it("rejeita 'arrange_with_store' (removida nesta revisão — seleção nunca é 'combinar com a loja')", () => {
    const result = whatsappCheckoutSchema.safeParse({ ...baseFields, paymentPreference: "arrange_with_store" });
    expect(result.success).toBe(false);
  });

  it("rejeita qualquer outro valor arbitrário — nenhum campo de texto livre", () => {
    for (const invalid of ["", "outro", "boleto", undefined]) {
      const result = whatsappCheckoutSchema.safeParse({ ...baseFields, paymentPreference: invalid });
      expect(result.success).toBe(false);
    }
  });
});

describe("whatsappCheckoutSchema — troco", () => {
  it("cashChangeFor é opcional (ausência = sem troco)", () => {
    const result = whatsappCheckoutSchema.safeParse({ ...baseFields, paymentPreference: "cash" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.cashChangeFor).toBeUndefined();
  });

  it("campo vazio também vira 'sem troco', nunca erro", () => {
    const result = whatsappCheckoutSchema.safeParse({ ...baseFields, paymentPreference: "cash", cashChangeFor: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.cashChangeFor).toBeUndefined();
  });

  it("aceita um valor positivo", () => {
    const result = whatsappCheckoutSchema.safeParse({ ...baseFields, paymentPreference: "cash", cashChangeFor: "100" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.cashChangeFor).toBe(100);
  });

  it("rejeita valor zero ou negativo", () => {
    for (const invalid of ["0", "-10"]) {
      const result = whatsappCheckoutSchema.safeParse({ ...baseFields, paymentPreference: "cash", cashChangeFor: invalid });
      expect(result.success).toBe(false);
    }
  });
});
