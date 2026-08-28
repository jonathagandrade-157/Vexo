import { describe, expect, it } from "vitest";

import { productSchema } from "@/features/products/schema";

/**
 * D3.2-B Ponto 2A — peso/dimensões físicas (weight/height/width/length),
 * fundação para uma futura cotação por transportadora. Cobre exatamente
 * o que a auditoria 2A definiu: opcionais, NULL/ausente permitido,
 * positivo estrito quando preenchido (zero e negativo sempre rejeitados),
 * decimais preservados.
 */
const BASE_INPUT = { name: "Produto Teste", price: "10.00" };

describe("productSchema — weight/height/width/length (D3.2-B Ponto 2A)", () => {
  it("accepts a product with none of the four fields (produto antigo/sem dados)", () => {
    const result = productSchema.safeParse(BASE_INPUT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.weight).toBeUndefined();
      expect(result.data.height).toBeUndefined();
      expect(result.data.width).toBeUndefined();
      expect(result.data.length).toBeUndefined();
    }
  });

  it("treats empty strings as undefined, never as 0", () => {
    const result = productSchema.safeParse({ ...BASE_INPUT, weight: "", height: "", width: "", length: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.weight).toBeUndefined();
      expect(result.data.height).toBeUndefined();
      expect(result.data.width).toBeUndefined();
      expect(result.data.length).toBeUndefined();
    }
  });

  it("accepts valid positive decimal values for all four fields", () => {
    const result = productSchema.safeParse({ ...BASE_INPUT, weight: "1.25", height: "10.5", width: "15.25", length: "20" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.weight).toBe(1.25);
      expect(result.data.height).toBe(10.5);
      expect(result.data.width).toBe(15.25);
      expect(result.data.length).toBe(20);
    }
  });

  it.each(["weight", "height", "width", "length"] as const)("rejects %s = 0", (field) => {
    const result = productSchema.safeParse({ ...BASE_INPUT, [field]: "0" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === field)).toBe(true);
    }
  });

  it.each(["weight", "height", "width", "length"] as const)("rejects %s negative", (field) => {
    const result = productSchema.safeParse({ ...BASE_INPUT, [field]: "-1" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === field)).toBe(true);
    }
  });

  it.each(["weight", "height", "width", "length"] as const)("rejects %s non-numeric", (field) => {
    const result = productSchema.safeParse({ ...BASE_INPUT, [field]: "abc" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === field)).toBe(true);
    }
  });

  it("allows a partial fill (e.g. only weight informed) without requiring the other three", () => {
    const result = productSchema.safeParse({ ...BASE_INPUT, weight: "0.5" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.weight).toBe(0.5);
      expect(result.data.height).toBeUndefined();
    }
  });
});
