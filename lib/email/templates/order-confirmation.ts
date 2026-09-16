import type { OrderConfirmation, OrderConfirmationItem } from "@/features/checkout/order-confirmation";
import { formatPrice } from "@/features/products/format-price";

/**
 * JON-13 — template PURO (sem I/O) do e-mail de "recebemos seu pedido"
 * (escopo do ticket: só confirmação de pedido feito, nunca pagamento
 * aprovado/recusado/envio/entrega — isso fica pra Pós-MVP). Reaproveita
 * `OrderConfirmation` (o mesmo tipo que já monta a página
 * `/pedido/[orderId]`, features/checkout/order-confirmation.ts) — nenhum
 * campo novo, nenhuma query nova.
 *
 * Deliberadamente NUNCA diz "pedido confirmado": no momento em que este
 * e-mail é disparado (dentro de `after()`, ver lib/email/send-order-
 * confirmation.ts), o cliente ainda não terminou de pagar em NENHUM dos
 * dois fluxos — `vexo_checkout` dispara antes de `initiatePaymentForOrder`/
 * redirect ao Mercado Pago, `whatsapp` sempre depende de um pagamento
 * combinado fora da VEXO. Por isso um único template serve os dois
 * fluxos (só o texto do próximo passo muda, via `orderSource`), sem
 * precisar afirmar algo que ainda pode não se concretizar.
 */
export interface OrderConfirmationEmailContext {
  storeName: string;
  /** Link para app/loja/[slug]/pedido/[orderId] — montado pelo chamador a partir de NEXT_PUBLIC_SITE_URL. */
  orderUrl: string;
}

export interface OrderConfirmationEmailResult {
  subject: string;
  html: string;
}

/** HTML é montado como string simples (decisão do ticket: sem @react-email/components) — todo valor com origem em input de cliente/lojista passa por aqui antes de entrar no HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function itemLabel(item: OrderConfirmationItem): string {
  const name = escapeHtml(item.productName);
  if (!item.variantLabel) return name;
  return `${name} <span style="color:#666;">(${escapeHtml(item.variantLabel)})</span>`;
}

function renderItemsRows(items: OrderConfirmationItem[]): string {
  return items
    .map(
      (item) => `
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #eee;">${itemLabel(item)}<br/><span style="color:#666;font-size:13px;">Qtd: ${item.quantity} × ${formatPrice(item.unitPrice)}</span></td>
          <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">${formatPrice(item.subtotal)}</td>
        </tr>`,
    )
    .join("");
}

function renderAddressBlock(order: OrderConfirmation): string {
  if (order.shippingProvider === "pickup") {
    return `<p style="margin:0 0 16px;color:#333;">Retirada na loja.</p>`;
  }
  if (!order.shippingAddress) return "";
  const a = order.shippingAddress;
  const complement = a.complement ? ` — ${escapeHtml(a.complement)}` : "";
  return `
    <p style="margin:0 0 16px;color:#333;">
      Entrega: ${escapeHtml(a.street)}, ${escapeHtml(a.number)}${complement}<br/>
      ${escapeHtml(a.neighborhood)} — ${escapeHtml(a.city)}/${escapeHtml(a.state)}<br/>
      CEP ${escapeHtml(a.zip)}
    </p>`;
}

/** Copy do próximo passo — nunca "confirmado", sempre "finalize o pagamento" (ver cabeçalho do arquivo). */
function nextStepCopy(order: OrderConfirmation): string {
  if (order.orderSource === "whatsapp") {
    return "Finalize o pagamento combinado pelo WhatsApp para confirmar seu pedido.";
  }
  return "Finalize o pagamento para confirmar seu pedido.";
}

export function buildOrderConfirmationEmail(
  order: OrderConfirmation,
  ctx: OrderConfirmationEmailContext,
): OrderConfirmationEmailResult {
  const storeName = escapeHtml(ctx.storeName);
  const customerName = escapeHtml(order.customerName);
  const subject = `Recebemos seu pedido #${order.orderNumber} — ${ctx.storeName}`;

  const discountRow =
    order.discountTotal > 0
      ? `<tr><td style="padding:4px 0;color:#333;">Desconto</td><td style="padding:4px 0;text-align:right;color:#333;">-${formatPrice(order.discountTotal)}</td></tr>`
      : "";

  const html = `
<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" style="background:#f5f5f5;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:8px;padding:32px;">
            <tr>
              <td>
                <h1 style="margin:0 0 8px;font-size:20px;color:#111;">Recebemos seu pedido!</h1>
                <p style="margin:0 0 16px;color:#333;">
                  Olá, ${customerName}. Recebemos seu pedido <strong>#${order.orderNumber}</strong> na loja <strong>${storeName}</strong>.
                </p>
                <p style="margin:0 0 24px;color:#333;font-weight:bold;">${nextStepCopy(order)}</p>

                ${renderAddressBlock(order)}

                <table role="presentation" width="100%" style="border-collapse:collapse;margin-bottom:16px;">
                  ${renderItemsRows(order.items)}
                </table>

                <table role="presentation" width="100%" style="border-collapse:collapse;">
                  <tr><td style="padding:4px 0;color:#333;">Subtotal</td><td style="padding:4px 0;text-align:right;color:#333;">${formatPrice(order.subtotal)}</td></tr>
                  <tr><td style="padding:4px 0;color:#333;">Frete</td><td style="padding:4px 0;text-align:right;color:#333;">${formatPrice(order.shippingTotal)}</td></tr>
                  ${discountRow}
                  <tr><td style="padding:8px 0 0;font-weight:bold;color:#111;border-top:1px solid #eee;">Total</td><td style="padding:8px 0 0;text-align:right;font-weight:bold;color:#111;border-top:1px solid #eee;">${formatPrice(order.total)}</td></tr>
                </table>

                <p style="margin:24px 0 0;">
                  <a href="${escapeHtml(ctx.orderUrl)}" style="color:#6D28D9;">Ver detalhes do pedido</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();

  return { subject, html };
}
