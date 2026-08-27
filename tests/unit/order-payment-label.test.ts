import { describe, expect, it } from "vitest";
import { getPaymentMethodLabel } from "@/features/orders/schema";

describe("getPaymentMethodLabel", () => {
  it("pedido gateway é sempre 'Mercado Pago', independente de requested_payment_method", () => {
    expect(getPaymentMethodLabel({ payment_channel: "gateway", requested_payment_method: null })).toBe("Mercado Pago");
  });

  it("pedido externo usa o rótulo do método solicitado", () => {
    expect(getPaymentMethodLabel({ payment_channel: "external", requested_payment_method: "pix" })).toBe("PIX");
    expect(getPaymentMethodLabel({ payment_channel: "external", requested_payment_method: "cash" })).toBe("Dinheiro");
    expect(getPaymentMethodLabel({ payment_channel: "external", requested_payment_method: "card" })).toBe("Cartão");
  });

  it("pedido externo sem método (nunca deveria acontecer pela constraint do banco) cai num rótulo genérico, nunca quebra", () => {
    expect(getPaymentMethodLabel({ payment_channel: "external", requested_payment_method: null })).toBe("Externo");
  });
});
