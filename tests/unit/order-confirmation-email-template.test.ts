import { describe, expect, it } from "vitest";

import { buildOrderConfirmationEmail } from "@/lib/email/templates/order-confirmation";
import type { OrderConfirmation } from "@/features/checkout/order-confirmation";

/**
 * JON-13 — template puro de "recebemos seu pedido". Escopo do ticket: só
 * confirmação de pedido feito (nunca pagamento aprovado/recusado/envio/
 * entrega). Cobre especialmente o ajuste pedido na revisão: nunca afirmar
 * "confirmado" — o pagamento ainda não terminou em nenhum dos dois fluxos
 * no momento do disparo (ver cabeçalho de lib/email/templates/order-
 * confirmation.ts) — e o escape de HTML de todo valor com origem em
 * cliente/lojista.
 */

const BASE_ORDER: OrderConfirmation = {
  orderNumber: "1001",
  status: "confirmed",
  paymentStatus: "PENDING",
  orderSource: "vexo_checkout",
  requestedPaymentMethod: null,
  cashChangeFor: null,
  customerName: "Maria",
  shippingAddress: {
    zip: "01310100",
    street: "Av. Paulista",
    number: "1000",
    neighborhood: "Bela Vista",
    city: "São Paulo",
    state: "SP",
  },
  shippingMethod: "Entrega padrão",
  shippingProvider: "flat_rate",
  shippingEstimatedDays: 5,
  subtotal: 100,
  shippingTotal: 10,
  discountTotal: 0,
  total: 110,
  createdAt: new Date().toISOString(),
  items: [
    {
      productName: "Camiseta Básica",
      productSlug: "camiseta-basica",
      quantity: 2,
      unitPrice: 50,
      subtotal: 100,
      variantId: null,
      variantSku: null,
      variantLabel: null,
      variantOptions: null,
    },
  ],
};

const CTX = { storeName: "Loja Teste", orderUrl: "https://vexoecommerce.vercel.app/loja/loja-teste/pedido/order-1" };

describe("buildOrderConfirmationEmail", () => {
  it("assunto inclui o número do pedido e o nome da loja", () => {
    const { subject } = buildOrderConfirmationEmail(BASE_ORDER, CTX);
    expect(subject).toBe("Recebemos seu pedido #1001 — Loja Teste");
  });

  it("nunca afirma 'confirmado' — nem no fluxo vexo_checkout nem no whatsapp (pagamento ainda não terminou no disparo)", () => {
    const vexoResult = buildOrderConfirmationEmail(BASE_ORDER, CTX);
    const whatsappResult = buildOrderConfirmationEmail({ ...BASE_ORDER, orderSource: "whatsapp" }, CTX);

    for (const { subject, html } of [vexoResult, whatsappResult]) {
      expect(subject.toLowerCase()).not.toContain("confirmado");
      expect(html.toLowerCase()).not.toContain("pedido confirmado");
    }
  });

  it("vexo_checkout: pede para finalizar o pagamento (sem mencionar WhatsApp)", () => {
    const { html } = buildOrderConfirmationEmail(BASE_ORDER, CTX);
    expect(html).toContain("Finalize o pagamento para confirmar seu pedido.");
    expect(html).not.toContain("WhatsApp");
  });

  it("whatsapp: pede para finalizar o pagamento combinado pelo WhatsApp", () => {
    const { html } = buildOrderConfirmationEmail({ ...BASE_ORDER, orderSource: "whatsapp" }, CTX);
    expect(html).toContain("Finalize o pagamento combinado pelo WhatsApp para confirmar seu pedido.");
  });

  it("retirada na loja (shippingProvider='pickup'): mostra aviso de retirada, nunca o bloco de endereço", () => {
    const order: OrderConfirmation = { ...BASE_ORDER, shippingProvider: "pickup", shippingAddress: null };
    const { html } = buildOrderConfirmationEmail(order, CTX);
    expect(html).toContain("Retirada na loja.");
    expect(html).not.toContain("CEP");
  });

  it("entrega: mostra o endereço completo", () => {
    const { html } = buildOrderConfirmationEmail(BASE_ORDER, CTX);
    expect(html).toContain("Av. Paulista, 1000");
    expect(html).toContain("Bela Vista — São Paulo/SP");
    expect(html).toContain("CEP 01310100");
  });

  it("item com variante mostra o rótulo da variante; item sem variante não mostra nada extra", () => {
    const withVariant: OrderConfirmation = {
      ...BASE_ORDER,
      items: [{ ...BASE_ORDER.items[0]!, variantLabel: "Azul / M" }],
    };
    const { html: htmlWith } = buildOrderConfirmationEmail(withVariant, CTX);
    expect(htmlWith).toContain("Azul / M");

    const { html: htmlWithout } = buildOrderConfirmationEmail(BASE_ORDER, CTX);
    expect(htmlWithout).not.toContain('<span style="color:#666;">(');
  });

  it("desconto > 0 mostra a linha de desconto; desconto = 0 não mostra nada", () => {
    const withDiscount: OrderConfirmation = { ...BASE_ORDER, discountTotal: 15 };
    const { html: htmlWith } = buildOrderConfirmationEmail(withDiscount, CTX);
    expect(htmlWith).toContain("Desconto");
    expect(htmlWith).toContain("-R$ 15,00");

    const { html: htmlWithout } = buildOrderConfirmationEmail(BASE_ORDER, CTX);
    expect(htmlWithout).not.toContain("Desconto");
  });

  it("totais são formatados em BRL (pt-BR)", () => {
    const { html } = buildOrderConfirmationEmail(BASE_ORDER, CTX);
    expect(html).toContain("R$ 100,00"); // subtotal
    expect(html).toContain("R$ 10,00"); // frete
    expect(html).toContain("R$ 110,00"); // total
  });

  it("inclui o link para a página do pedido", () => {
    const { html } = buildOrderConfirmationEmail(BASE_ORDER, CTX);
    expect(html).toContain(`href="${CTX.orderUrl}"`);
  });

  it("escapa HTML de nome do cliente, nome da loja e nome do produto — nunca injeta tag bruta", () => {
    const malicious: OrderConfirmation = {
      ...BASE_ORDER,
      customerName: '<img src=x onerror="alert(1)">',
      items: [{ ...BASE_ORDER.items[0]!, productName: "<script>alert(1)</script>" }],
    };
    const { html } = buildOrderConfirmationEmail(malicious, { ...CTX, storeName: "<b>Loja</b>" });

    expect(html).not.toContain("<img src=x onerror=");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<b>Loja</b>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;Loja&lt;/b&gt;");
  });
});
