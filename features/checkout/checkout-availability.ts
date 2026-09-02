import { normalizeBrazilianPhone } from "@/lib/whatsapp/phone";
import type { CheckoutMode } from "@/features/settings/checkout-schema";

export interface CheckoutAvailability {
  /** "Pagar online" (Mercado Pago) é uma opção real agora. */
  onlineAllowed: boolean;
  /** "Pedir pelo WhatsApp" é uma opção real agora — por modo (`whatsapp`/`both`) ou por fallback (`vexo` sem gateway). */
  whatsappAllowed: boolean;
  /**
   * D14.1 — true só quando o WhatsApp está sendo oferecido como
   * substituto do checkout online numa loja `checkout_mode = 'vexo'`
   * (o padrão de fábrica) que ainda não conectou nenhum meio de
   * pagamento. Nunca true para `checkout_mode = 'whatsapp'/'both'` —
   * nesses modos o WhatsApp já é um caminho de primeira classe, não um
   * substituto de emergência.
   */
  isWhatsappFallback: boolean;
}

/**
 * D14.1 — única fonte de verdade de "o que esta loja realmente oferece
 * agora" (prompt: "não duplicar lógica de criação de pedido" aplica
 * igualmente à lógica de DECISÃO — antes esta conta era feita duas vezes,
 * de formas ligeiramente diferentes, em `app/loja/[slug]/checkout/
 * page.tsx` e em `CheckoutForm`). Função pura, sem I/O — chamada tanto no
 * servidor (página, Server Actions) quanto no cliente (CheckoutForm, só
 * para decidir o que mostrar; a autoridade real de segurança é sempre a
 * mesma checagem refeita no servidor dentro das Server Actions).
 *
 * NUNCA muda `checkout_mode` — só decide, para o modo atual, se
 * "pagar online" e/ou "pedir pelo WhatsApp" são caminhos reais agora:
 *
 * - `vexo` + gateway conectado         → só online.
 * - `vexo` + gateway ausente + WhatsApp configurado (telefone válido)
 *                                       → só WhatsApp, como FALLBACK.
 * - `vexo` + gateway ausente + WhatsApp não configurado
 *                                       → nenhum caminho (dead-end real,
 *                                         a página explica o que falta).
 * - `whatsapp`                         → só WhatsApp, sempre (nunca
 *                                         checa telefone — mesmo
 *                                         comportamento já existente,
 *                                         preservado sem alteração).
 * - `both`                             → WhatsApp sempre; online só se
 *                                         o gateway estiver conectado
 *                                         (mesmo comportamento já
 *                                         existente, preservado).
 */
export function resolveCheckoutAvailability(
  checkoutMode: CheckoutMode,
  gatewayConnected: boolean,
  whatsappPhone: string | null,
): CheckoutAvailability {
  const onlineAllowed = checkoutMode !== "whatsapp" && gatewayConnected;
  const isWhatsappFallback = checkoutMode === "vexo" && !gatewayConnected && isWhatsappConfigured(whatsappPhone);
  const whatsappAllowed = checkoutMode === "whatsapp" || checkoutMode === "both" || isWhatsappFallback;

  return { onlineAllowed, whatsappAllowed, isWhatsappFallback };
}

/** Mesma regra de validade já usada para montar o link `wa.me` (`getWhatsappOrderLink`) — nunca uma segunda heurística. */
export function isWhatsappConfigured(whatsappPhone: string | null): boolean {
  return whatsappPhone !== null && normalizeBrazilianPhone(whatsappPhone) !== null;
}
