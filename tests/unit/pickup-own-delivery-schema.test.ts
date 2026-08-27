import { describe, expect, it } from "vitest";
import { ownDeliverySettingsSchema, pickupSettingsSchema } from "@/features/shipping/schema";

describe("pickupSettingsSchema (D3.1 §3/§8)", () => {
  const VALID = { name: "Retirar na loja", estimatedDays: "1", active: "on" };

  it("accepts a valid payload and coerces active/estimatedDays", () => {
    const result = pickupSettingsSchema.safeParse(VALID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.active).toBe(true);
      expect(result.data.estimatedDays).toBe(1);
    }
  });

  it("has no price field — pickup price is never client-editable (always 0, enforced by the database)", () => {
    expect("price" in pickupSettingsSchema.shape).toBe(false);
  });

  it("rejects an empty name", () => {
    const result = pickupSettingsSchema.safeParse({ ...VALID, name: "" });
    expect(result.success).toBe(false);
  });

  it("treats estimatedDays as optional — empty becomes undefined, not an error", () => {
    const result = pickupSettingsSchema.safeParse({ ...VALID, estimatedDays: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.estimatedDays).toBeUndefined();
  });

  it("rejects a non-positive estimatedDays", () => {
    for (const invalid of ["0", "-1"]) {
      expect(pickupSettingsSchema.safeParse({ ...VALID, estimatedDays: invalid }).success).toBe(false);
    }
  });

  it("coerces active from an unchecked checkbox (field absent from FormData) to false", () => {
    const result = pickupSettingsSchema.safeParse({ name: "Retirar na loja", estimatedDays: "1", active: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.active).toBe(false);
  });
});

describe("ownDeliverySettingsSchema (D3.1 §3/§8)", () => {
  const VALID = { name: "Entrega própria", price: "8.5", estimatedDays: "2", active: "on" };

  it("accepts a valid payload and coerces price/active/estimatedDays", () => {
    const result = ownDeliverySettingsSchema.safeParse(VALID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.price).toBe(8.5);
      expect(result.data.active).toBe(true);
      expect(result.data.estimatedDays).toBe(2);
    }
  });

  it("rejects a negative price — server always revalidates it before applying to an order", () => {
    const result = ownDeliverySettingsSchema.safeParse({ ...VALID, price: "-1" });
    expect(result.success).toBe(false);
  });

  it("accepts price = 0 (free own-delivery is a valid store decision, unlike pickup which is enforced at the database)", () => {
    const result = ownDeliverySettingsSchema.safeParse({ ...VALID, price: "0" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty name", () => {
    const result = ownDeliverySettingsSchema.safeParse({ ...VALID, name: "" });
    expect(result.success).toBe(false);
  });

  it("has no sortOrder field — it's a singleton row, not a list to reorder", () => {
    expect("sortOrder" in ownDeliverySettingsSchema.shape).toBe(false);
  });
});
