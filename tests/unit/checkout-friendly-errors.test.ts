import { describe, expect, it } from "vitest";

import { friendlyCheckoutError } from "@/features/checkout/schema";

describe("friendlyCheckoutError — secure checkout", () => {
  it.each([
    ["cart ownership could not be verified", "sessão do seu carrinho expirou"],
    ["shipping price has changed", "frete mudou"],
    ["shipping method not available", "frete mudou"],
    ["shipping method is required", "opção de entrega válida"],
    ["order has no shipping address for this method", "endereço válido"],
    ["cash change amount is less than the order total", "troco é menor"],
  ])("maps %s without exposing the PostgreSQL message", (databaseMessage, expectedText) => {
    const result = friendlyCheckoutError(databaseMessage);
    expect(result).toContain(expectedText);
    expect(result).not.toBe(databaseMessage);
  });
});
