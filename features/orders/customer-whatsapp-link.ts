import { buildWhatsappLink } from "@/lib/whatsapp/link";
import { normalizeBrazilianPhone } from "@/lib/whatsapp/phone";

/**
 * Fase D2-B.3 — "Conversar no WhatsApp" no detalhe do pedido (painel).
 * Direção oposta de `features/checkout/whatsapp-link.ts` (que fala COM a
 * loja): aqui o destino é sempre `orders.customer_phone`, já validado e
 * armazenado no momento da criação do pedido — nunca um telefone
 * digitado agora, nunca controlável pelo cliente depois da criação.
 *
 * Reaproveita os mesmos dois helpers de sempre (`normalizeBrazilianPhone`/
 * `buildWhatsappLink`) — nenhuma segunda implementação de link do
 * WhatsApp. Função pura, sem I/O — quem chama já tem o pedido carregado.
 */
export function getCustomerWhatsappLink(orderNumber: string, customerName: string, customerPhone: string): string | null {
  const normalized = normalizeBrazilianPhone(customerPhone);
  if (!normalized) return null;

  const firstName = customerName.trim().split(/\s+/)[0] ?? customerName;
  const message = `Olá ${firstName}! Aqui é da loja, sobre o seu pedido ${orderNumber}.`;
  return buildWhatsappLink(normalized, message);
}
