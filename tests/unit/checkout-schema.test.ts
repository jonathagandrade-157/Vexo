import { describe, expect, it } from "vitest";
import { checkoutSchema, isAddressComplete } from "@/features/checkout/schema";

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

  // D3.1 §7: os 6 campos de endereço são opcionais na camada Zod (retirada
  // na loja não pede endereço do cliente) — a exigência real para as
  // demais modalidades é aplicada depois, no Server Action, via
  // `isAddressComplete`, nunca aqui.
  it("D3.1: treats the 6 address fields as optional — an empty field becomes undefined, not a validation error", () => {
    for (const field of ["zip", "street", "number", "city", "neighborhood", "state"] as const) {
      const result = checkoutSchema.safeParse({ ...VALID, [field]: "" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data[field]).toBeUndefined();
    }
  });

  it("D3.1: accepts a payload with no address fields at all (pickup)", () => {
    const { zip: _zip, street: _street, number: _number, complement: _complement, neighborhood: _neighborhood, city: _city, state: _state, ...withoutAddress } = VALID;
    const result = checkoutSchema.safeParse(withoutAddress);
    expect(result.success).toBe(true);
  });

  it("D3.1: still rejects an invalid (non-empty) state or a malformed (non-empty) CEP", () => {
    expect(checkoutSchema.safeParse({ ...VALID, state: "ZZ" }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...VALID, zip: "123" }).success).toBe(false);
  });
});

describe("isAddressComplete (D3.1 §7)", () => {
  it("returns true when all 6 required address fields are present", () => {
    const parsed = checkoutSchema.safeParse(VALID);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(isAddressComplete(parsed.data)).toBe(true);
  });

  it("returns false when any required address field is missing (pickup / partial submission)", () => {
    const { zip: _zip, street: _street, number: _number, complement: _complement, neighborhood: _neighborhood, city: _city, state: _state, ...withoutAddress } = VALID;
    const parsed = checkoutSchema.safeParse(withoutAddress);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(isAddressComplete(parsed.data)).toBe(false);
  });

  it("returns false when only some address fields are present", () => {
    const parsed = checkoutSchema.safeParse({ ...VALID, city: "", state: "" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(isAddressComplete(parsed.data)).toBe(false);
  });
});
