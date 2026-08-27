/**
 * Fase D2-B. Normalização/validação de telefone brasileiro para uso em
 * `wa.me` — regra única do projeto, reaproveitada por
 * `features/storefront/contact-links.ts` (que antes só prefixava "55" por
 * comprimento de string, sem validar DDD nem rejeitar entrada malformada
 * — heurística suficiente para um link de contato exibido no rodapé, mas
 * não para o destino de uma mensagem de pedido).
 *
 * Aceita, só dígitos após remover tudo que não é dígito:
 *   - 10 dígitos: DDD (2) + fixo (8), sem DDI
 *   - 11 dígitos: DDD (2) + celular (9), sem DDI
 *   - 12 dígitos: 55 + DDD (2) + fixo (8)
 *   - 13 dígitos: 55 + DDD (2) + celular (9)
 * Qualquer outro formato, DDD fora da faixa real, ou celular de 9 dígitos
 * que não começa em "9" (só existem celulares 9XXXXXXXX no Brasil desde a
 * padronização de 2016) retorna `null` — nunca lança, nunca produz um link
 * quebrado silenciosamente. O chamador decide o que fazer com "sem
 * WhatsApp válido" (ex.: não mostrar o botão).
 */

const VALID_DDD = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, // SP
  21, 22, 24, // RJ
  27, 28, // ES
  31, 32, 33, 34, 35, 37, 38, // MG
  41, 42, 43, 44, 45, 46, // PR
  47, 48, 49, // SC
  51, 53, 54, 55, // RS
  61, // DF
  62, 64, // GO
  63, // TO
  65, 66, // MT
  67, // MS
  68, // AC
  69, // RO
  71, 73, 74, 75, 77, // BA
  79, // SE
  81, 87, // PE
  82, // AL
  83, // PB
  84, // RN
  85, 88, // CE
  86, 89, // PI
  91, 93, 94, // PA
  92, 97, // AM
  95, // RR
  96, // AP
  98, 99, // MA
]);

export function normalizeBrazilianPhone(rawPhone: string): string | null {
  const digits = rawPhone.replace(/\D/g, "");

  let ddd: string;
  let subscriber: string;

  if (digits.length === 10 || digits.length === 11) {
    ddd = digits.slice(0, 2);
    subscriber = digits.slice(2);
  } else if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    ddd = digits.slice(2, 4);
    subscriber = digits.slice(4);
  } else {
    return null;
  }

  if (!VALID_DDD.has(Number(ddd))) return null;
  if (subscriber.length !== 8 && subscriber.length !== 9) return null;
  if (subscriber.length === 9 && subscriber[0] !== "9") return null;

  return `55${ddd}${subscriber}`;
}
