import { describe, expect, it } from "vitest";
import { checkoutSchema } from "@/features/checkout/schema";

const VALID = {
  customerName: "Maria da Silva",
  customerEmail: "maria@example.com",
  customerPhone: "(11) 91234-5678",
  zip: "01310-100",
  street: "Av. Paulista",
  number: "1000",
  complement: "Sala 1",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
};

describe("checkoutSchema", () => {
  it("accepts a fully valid payload and normalizes the CEP to digits only", () => {
    const result = checkoutSchema.safeParse(VALID);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.zip).toBe("01310100");
  });

  it("rejects an invalid e-mail", () => {
    const result = checkoutSchema.safeParse({ ...VALID, customerEmail: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects a phone with fewer than 10 digits", () => {
    const result = checkoutSchema.safeParse({ ...VALID, customerPhone: "123" });
    expect(result.success).toBe(false);
  });

  it("rejects a CEP that isn't 8 digits", () => {
    const result = checkoutSchema.safeParse({ ...VALID, zip: "123" });
    expect(result.success).toBe(false);
  });

  it("rejects a name that's too short", () => {
    const result = checkoutSchema.safeParse({ ...VALID, customerName: "A" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid state", () => {
    const result = checkoutSchema.safeParse({ ...VALID, state: "ZZ" });
    expect(result.success).toBe(false);
  });

  it("treats complement as optional", () => {
    const { complement: _complement, ...withoutComplement } = VALID;
    const result = checkoutSchema.safeParse(withoutComplement);
    expect(result.success).toBe(true);
  });

  it("rejects missing street/number/city/neighborhood", () => {
    for (const field of ["street", "number", "city", "neighborhood"] as const) {
      const result = checkoutSchema.safeParse({ ...VALID, [field]: "" });
      expect(result.success).toBe(false);
    }
  });
});
