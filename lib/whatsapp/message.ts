/**
 * Fase D2-B (revisão final). Vocabulário de forma de pagamento do fluxo
 * WhatsApp definido aqui (não em `features/checkout/*`) para manter a
 * direção de dependência correta: `lib/` nunca importa de `features/`. O
 * schema Zod (`features/checkout/whatsapp-schema.ts`) importa estes
 * valores daqui, não o contrário.
 *
 * Exatamente 3 opções, seleção obrigatória — sem "combinar com a
 * loja"/"outro"/texto livre (decisão explícita desta revisão). PIX e
 * Cartão nunca são processados pela VEXO nesta fase; Dinheiro pode
 * carregar um valor de troco, também nunca processado — tudo aqui é
 * informativo, só para compor a mensagem enviada ao lojista.
 */
export const REQUESTED_PAYMENT_METHODS = ["pix", "cash", "card"] as const;
export type RequestedPaymentMethod = (typeof REQUESTED_PAYMENT_METHODS)[number];

export const REQUESTED_PAYMENT_METHOD_LABELS: Record<RequestedPaymentMethod, string> = {
  pix: "PIX",
  cash: "Dinheiro",
  card: "Cartão",
};

const REQUESTED_PAYMENT_METHOD_EMOJI: Record<RequestedPaymentMethod, string> = {
  pix: "💠",
  cash: "💵",
  card: "💳",
};

export interface WhatsappOrderItem {
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface WhatsappOrderAddress {
  zip: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
}

export interface WhatsappOrderData {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  items: WhatsappOrderItem[];
  subtotal: number;
  shippingTotal: number;
  total: number;
  shippingAddress: WhatsappOrderAddress;
  requestedPaymentMethod: RequestedPaymentMethod;
  /**
   * Só relevante quando requestedPaymentMethod='cash'. `null` = cliente
   * paga o valor exato, sem troco (nunca confundir com "não informado" —
   * o formulário sempre obriga a escolha "Precisa de troco? Não/Sim", ver
   * whatsapp-schema.ts). Nunca lido do navegador aqui — sempre a mesma
   * leitura de `orders.cash_change_for` já validada no servidor no
   * momento da criação do pedido.
   */
  cashChangeFor: number | null;
}

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function buildPaymentSection(order: WhatsappOrderData): string {
  const emoji = REQUESTED_PAYMENT_METHOD_EMOJI[order.requestedPaymentMethod];
  const label = REQUESTED_PAYMENT_METHOD_LABELS[order.requestedPaymentMethod];
  const lines = [`${emoji} PAGAMENTO`, label];

  if (order.requestedPaymentMethod === "cash") {
    if (order.cashChangeFor === null) {
      lines.push("Sem necessidade de troco.");
    } else {
      lines.push("", `💰 Troco para: ${formatBRL(order.cashChangeFor)}`, `💵 Troco necessário: ${formatBRL(order.cashChangeFor - order.total)}`);
    }
  }

  if (order.requestedPaymentMethod === "pix") {
    lines.push("", "📎 Comprovante do PIX será enviado nesta conversa.", "", "Por favor, confira o pagamento antes de confirmar o pedido.");
  }

  return lines.join("\n");
}

/**
 * Função pura — recebe só dados já resolvidos no servidor
 * (`features/checkout/whatsapp-link.ts`, a partir de `orders`/
 * `order_items` reais via service_role). Nunca lê request/formData; nunca
 * aceita preço/subtotal/total/troco de fora — quem monta o objeto de
 * entrada é sempre uma leitura fresca do banco, nunca o navegador.
 */
export function buildOrderWhatsappMessage(order: WhatsappOrderData): string {
  const productLines = order.items
    .map((item) => `${item.quantity}x ${item.productName} — ${formatBRL(item.subtotal)}`)
    .join("\n");

  const addressLines = [
    `${order.shippingAddress.street}, ${order.shippingAddress.number}${
      order.shippingAddress.complement ? ` — ${order.shippingAddress.complement}` : ""
    }`,
    order.shippingAddress.neighborhood,
    `${order.shippingAddress.city} - ${order.shippingAddress.state}`,
    `CEP ${order.shippingAddress.zip.replace(/(\d{5})(\d{3})/, "$1-$2")}`,
  ].join("\n");

  return [
    "🛍️ NOVO PEDIDO — VEXO",
    "",
    `Pedido #${order.orderNumber}`,
    "",
    "👤 CLIENTE",
    order.customerName,
    "",
    "📱 Telefone",
    order.customerPhone,
    "",
    "🛒 PRODUTOS",
    "",
    productLines,
    "",
    `Subtotal: ${formatBRL(order.subtotal)}`,
    `Entrega: ${formatBRL(order.shippingTotal)}`,
    "",
    `💰 TOTAL: ${formatBRL(order.total)}`,
    "",
    "🚚 ENTREGA",
    "",
    addressLines,
    "",
    buildPaymentSection(order),
  ].join("\n");
}
