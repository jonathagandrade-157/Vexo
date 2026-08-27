import { normalizeBrazilianPhone } from "@/lib/whatsapp/phone";

/**
 * Constrói links reais a partir dos campos de contato da Etapa 4 — nada
 * inventado, só formatação do dado que já existe. Normalização de
 * telefone (Fase D2-B) reaproveitada de `lib/whatsapp/phone.ts` — regra
 * única do projeto, nunca uma segunda heurística divergente aqui. Se o
 * número cadastrado não normaliza para um telefone BR válido, cai de
 * volta no comportamento anterior (só prefixa "55" quando necessário) em
 * vez de quebrar o link do rodapé por completo — este é um link de
 * contato de baixo risco, não o destino de uma mensagem de pedido.
 */
export function whatsappLink(phone: string): string {
  const normalized = normalizeBrazilianPhone(phone);
  if (normalized) return `https://wa.me/${normalized}`;

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
