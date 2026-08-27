/**
 * Fase D2-B. Monta o link final `wa.me` a partir de um telefone já
 * normalizado (`lib/whatsapp/phone.ts`) e uma mensagem já pronta
 * (`lib/whatsapp/message.ts`). Função pura, sem I/O — quem decide QUAL
 * telefone/mensagem entram aqui é sempre `features/checkout/
 * whatsapp-link.ts` (leitura de servidor), nunca esta função.
 */
export function buildWhatsappLink(normalizedPhone: string, message: string): string {
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
}
