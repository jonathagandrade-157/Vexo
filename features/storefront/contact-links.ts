/**
 * Constrói links reais a partir dos campos de contato da Etapa 4 — nada
 * inventado, só formatação do dado que já existe. `whatsapp_phone` é
 * validado (Etapa 4) como só dígitos com 10+ caracteres, sem DDI; se já
 * vier com DDI (13 dígitos, caso alguém tenha digitado assim mesmo sem
 * isso ser exigido), não duplica o "55".
 */
export function whatsappLink(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const withCountryCode = digits.length > 11 ? digits : `55${digits}`;
  return `https://wa.me/${withCountryCode}`;
}

export function instagramLink(handle: string): string {
  return `https://instagram.com/${handle}`;
}

export function emailLink(email: string): string {
  return `mailto:${email}`;
}
