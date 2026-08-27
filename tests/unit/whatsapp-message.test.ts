import { describe, expect, it } from "vitest";
import { buildOrderWhatsappMessage, REQUESTED_PAYMENT_METHOD_LABELS, type WhatsappOrderAddress, type WhatsappOrderData } from "@/lib/whatsapp/message";

/** Mesma formatação da função sob teste — `Intl` usa um espaço NBSP (U+00A0) entre "R$" e o valor, não um espaço comum. */
function brl(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const baseAddress: WhatsappOrderAddress = {
  zip: "01310100",
  street: "Rua Exemplo",
  number: "123",
  complement: null,
  neighborhood: "Vila Maria",
  city: "São Paulo",
  state: "SP",
};

const baseOrder: WhatsappOrderData = {
  orderNumber: "PED001042",
  customerName: "João Andrade",
  customerPhone: "(11) 99999-9999",
  items: [
    { productName: "Heineken", quantity: 2, unitPrice: 12, subtotal: 24 },
    { productName: "Whisky", quantity: 1, unitPrice: 89.9, subtotal: 89.9 },
  ],
  subtotal: 113.9,
  shippingTotal: 10,
  total: 123.9,
  delivery: { kind: "address", address: baseAddress },
  requestedPaymentMethod: "pix",
  cashChangeFor: null,
};

describe("buildOrderWhatsappMessage", () => {
  it("inclui o número do pedido", () => {
    expect(buildOrderWhatsappMessage(baseOrder)).toContain("Pedido #PED001042");
  });

  it("inclui nome e telefone do cliente em seções separadas", () => {
    const message = buildOrderWhatsappMessage(baseOrder);
    expect(message).toContain("👤 CLIENTE\nJoão Andrade");
    expect(message).toContain("📱 Telefone\n(11) 99999-9999");
  });

  it("lista cada produto com quantidade e subtotal (nunca preço unitário calculado de novo)", () => {
    const message = buildOrderWhatsappMessage(baseOrder);
    expect(message).toContain(`2x Heineken — ${brl(24)}`);
    expect(message).toContain(`1x Whisky — ${brl(89.9)}`);
  });

  it("inclui subtotal, frete e total exatamente como recebidos — nunca recalculados", () => {
    const message = buildOrderWhatsappMessage(baseOrder);
    expect(message).toContain(`Subtotal: ${brl(113.9)}`);
    expect(message).toContain(`Entrega: ${brl(10)}`);
    expect(message).toContain(`💰 TOTAL: ${brl(123.9)}`);
  });

  it("inclui o endereço completo com CEP formatado", () => {
    const message = buildOrderWhatsappMessage(baseOrder);
    expect(message).toContain("Rua Exemplo, 123");
    expect(message).toContain("Vila Maria");
    expect(message).toContain("São Paulo - SP");
    expect(message).toContain("CEP 01310-100");
  });

  it("inclui o complemento quando presente", () => {
    const message = buildOrderWhatsappMessage({
      ...baseOrder,
      delivery: { kind: "address", address: { ...baseAddress, complement: "Apto 42" } },
    });
    expect(message).toContain("Rua Exemplo, 123 — Apto 42");
  });

  it("pickup com endereço da loja disponível: mostra 'Retirada na loja' e o endereço da loja, nunca lança", () => {
    const message = buildOrderWhatsappMessage({
      ...baseOrder,
      delivery: {
        kind: "pickup",
        storeAddress: { zip: "02634000", street: "Rua da Loja", number: "10", complement: null, neighborhood: "Centro", city: "São Paulo", state: "SP" },
      },
    });
    expect(message).toContain("🚚 ENTREGA\n\nRetirada na loja\nRua da Loja, 10");
    expect(message).toContain("CEP 02634-000");
  });

  it("pickup sem endereço da loja configurado: mostra só 'Retirada na loja', nunca inventa endereço, nunca lança", () => {
    expect(() =>
      buildOrderWhatsappMessage({ ...baseOrder, delivery: { kind: "pickup", storeAddress: null } }),
    ).not.toThrow();
    const message = buildOrderWhatsappMessage({ ...baseOrder, delivery: { kind: "pickup", storeAddress: null } });
    expect(message).toContain("🚚 ENTREGA\n\nRetirada na loja\n\n");
    expect(message).not.toContain("CEP");
  });

  it("PIX: mostra o rótulo, pede o comprovante na conversa e o aviso de conferência", () => {
    const message = buildOrderWhatsappMessage({ ...baseOrder, requestedPaymentMethod: "pix" });
    expect(message).toContain(`💠 PAGAMENTO\n${REQUESTED_PAYMENT_METHOD_LABELS.pix}`);
    expect(message).toContain("📎 Comprovante do PIX será enviado nesta conversa.");
    expect(message).toContain("Por favor, confira o pagamento antes de confirmar o pedido.");
  });

  it("Cartão: só registra a preferência, sem instrução extra", () => {
    const message = buildOrderWhatsappMessage({ ...baseOrder, requestedPaymentMethod: "card", cashChangeFor: null });
    expect(message).toContain(`💳 PAGAMENTO\n${REQUESTED_PAYMENT_METHOD_LABELS.card}`);
    expect(message).not.toContain("Comprovante");
    expect(message).not.toContain("Troco");
  });

  it("Dinheiro sem troco: mensagem explícita de 'sem necessidade de troco'", () => {
    const message = buildOrderWhatsappMessage({ ...baseOrder, requestedPaymentMethod: "cash", cashChangeFor: null });
    expect(message).toContain(`💵 PAGAMENTO\n${REQUESTED_PAYMENT_METHOD_LABELS.cash}`);
    expect(message).toContain("Sem necessidade de troco.");
  });

  it("Dinheiro com troco: mostra 'troco para' e o troco necessário calculado a partir do total real", () => {
    const message = buildOrderWhatsappMessage({ ...baseOrder, requestedPaymentMethod: "cash", cashChangeFor: 150 });
    expect(message).toContain(`💰 Troco para: ${brl(150)}`);
    expect(message).toContain(`💵 Troco necessário: ${brl(150 - baseOrder.total)}`);
  });

  it("nunca lança para um carrinho de um item só", () => {
    expect(() =>
      buildOrderWhatsappMessage({ ...baseOrder, items: [{ productName: "Produto único", quantity: 1, unitPrice: 10, subtotal: 10 }] }),
    ).not.toThrow();
  });
});
