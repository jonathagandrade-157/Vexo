import { describe, expect, it } from "vitest";

import { pricesMatchExactly, toCents } from "@/lib/utils/money";

describe("lib/utils/money — D3.2-B Ponto 2E", () => {
  it("toCents rounds to the nearest cent", () => {
    expect(toCents(27.48)).toBe(2748);
    expect(toCents(0.1)).toBe(10);
    expect(toCents(100)).toBe(10000);
  });

  it("pricesMatchExactly is true for identical decimal values", () => {
    expect(pricesMatchExactly(27.48, 27.48)).toBe(true);
  });

  it("pricesMatchExactly is false for any difference, however small", () => {
    expect(pricesMatchExactly(27.48, 27.49)).toBe(false);
    expect(pricesMatchExactly(1.0, 27.48)).toBe(false);
    expect(pricesMatchExactly(0.01, 27.48)).toBe(false);
  });

  it("avoids classic floating point comparison bugs (0.1 + 0.2 !== 0.3 in raw JS)", () => {
    expect(0.1 + 0.2 === 0.3).toBe(false); // sanity: the bug this module exists to avoid
    expect(pricesMatchExactly(0.1 + 0.2, 0.3)).toBe(true); // but at cent precision, it matches
  });

  it("is not fooled by a naive epsilon comparison's blind spot", () => {
    // Math.abs(a - b) > 0.01 (o padrão já existente em verifyShippingPriceFresh)
    // trataria 27.48 vs 27.485 como "igual" (diferença de 0.005 <= 0.01) —
    // pricesMatchExactly não, porque a granularidade real é centavos.
    expect(pricesMatchExactly(27.48, 27.485)).toBe(false);
  });
});
