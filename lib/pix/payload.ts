import { crc16ccitt } from "./crc16";
import type { PixKeyType } from "./key-types";

/**
 * Fase D2-B.2 — payload EMV/BR Code (Manual de Padrões para Iniciação do
 * Pix, Banco Central). Função pura — recebe só dados já resolvidos no
 * servidor (`features/checkout/pix-payment.ts`, a partir de
 * `tenants.pix_key/pix_key_type/pix_recipient_name/address_city` e
 * `orders.total/order_number` reais via service_role). Nunca lê request/
 * formData; nunca aceita chave/nome/cidade/valor de fora — quem monta o
 * objeto de entrada é sempre uma leitura fresca do banco, nunca o
 * navegador (mesmo contrato já usado por `lib/whatsapp/message.ts
 * ::buildOrderWhatsappMessage`).
 *
 * GUI fixo `br.gov.bcb.pix` (campo 26/00) é o identificador padrão do
 * arranjo Pix — não é uma URL de callback: como a VEXO nunca integra um
 * PSP para hospedar um JSON dinâmico, o payload é sempre "Pix estático
 * com valor fixo por transação" (campo 01 = "11"), nunca "Pix dinâmico"
 * (que exigiria um campo 25 com URL para consulta pelo banco pagador —
 * fora de escopo, dependeria de infraestrutura que a VEXO não tem nesta
 * fase).
 */

const GUI_PIX = "br.gov.bcb.pix";
const MERCHANT_CATEGORY_CODE = "0000";
const TRANSACTION_CURRENCY_BRL = "986";
const COUNTRY_CODE = "BR";
const MERCHANT_NAME_MAX_LENGTH = 25;
const MERCHANT_CITY_MAX_LENGTH = 15;
const TXID_MAX_LENGTH = 25;

export interface PixPayloadInput {
  pixKey: string;
  pixKeyType: PixKeyType;
  /** Nome do recebedor tal como salvo (`tenants.pix_recipient_name`) — sanitizado só aqui, nunca alterado na origem. */
  recipientName: string;
  /** Cidade da loja tal como salva (`tenants.address_city`, com acentos) — sanitizada só aqui, nunca alterada na origem. */
  city: string;
  /** Valor real do pedido, sempre calculado no servidor — nunca aceito do navegador. */
  amount: number;
  /** Identificador da transação (`orders.order_number`, ex. "PED000123") — nunca o UUID do pedido. */
  txid: string;
}

function tlv(id: string, value: string): string {
  return `${id}${value.length.toString().padStart(2, "0")}${value}`;
}

/**
 * Remove acentos, mantém só A-Z/0-9/espaço, maiúsculas, e trunca —
 * exigido pelo charset do padrão EMV para Merchant Name/City. Nunca
 * aplicado ao valor salvo/exibido no painel (`tenants.pix_recipient_name`/
 * `tenants.address_city` continuam com acentos) — só ao gerar o payload.
 */
function sanitizeMerchantText(input: string, maxLength: number): string {
  // Remove combining diacritical marks (U+0300–U+036F) left over after NFD
  // decomposition — e.g. "São Paulo" -> "Sa~o Paulo" -> "Sao Paulo". Written
  // as an explicit codepoint filter (not a regex literal) to avoid any risk
  // of the combining-mark range itself being mangled in source.
  const COMBINING_MARKS_START = 0x0300;
  const COMBINING_MARKS_END = 0x036f;
  const withoutAccents = Array.from(input.normalize("NFD"))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < COMBINING_MARKS_START || code > COMBINING_MARKS_END;
    })
    .join("");
  const asciiOnly = withoutAccents
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const sanitized = asciiOnly.slice(0, maxLength).toUpperCase();
  return sanitized.length > 0 ? sanitized : "NA";
}

/** Sub-campo txid (62/05) aceita só alfanumérico, até 25 caracteres — nunca o UUID do pedido, que tem hífens. */
function sanitizeTxid(input: string): string {
  const alnumOnly = input.replace(/[^a-zA-Z0-9]/g, "").slice(0, TXID_MAX_LENGTH);
  return alnumOnly.length > 0 ? alnumOnly : "***";
}

/**
 * A chave-telefone é salva sem o prefixo `+` (formato usado para
 * WhatsApp — `lib/whatsapp/phone.ts::normalizeBrazilianPhone`), mas o
 * padrão Pix exige `+5511999999999` para chave-telefone. Corrigido só
 * aqui, no momento de montar o payload — nunca no valor salvo/exibido.
 */
function formatPixKeyForPayload(pixKeyType: PixKeyType, pixKey: string): string {
  if (pixKeyType === "phone" && !pixKey.startsWith("+")) return `+${pixKey}`;
  return pixKey;
}

/**
 * Gera o payload BR Code (Pix Copia e Cola) para um pedido específico.
 * Lança `Error` para valores inválidos (nunca gera um QR/Copia-e-Cola
 * incompleto ou com valor zero/negativo) — quem chama decide como tratar
 * (nesta fase: nunca deveria acontecer, já que `amount` vem sempre de
 * `orders.total`, que a própria `create_order_from_cart` garante positivo).
 */
export function buildPixPayload(input: PixPayloadInput): string {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("pix payload amount must be a positive number");
  }

  const merchantAccountInfo = tlv("00", GUI_PIX) + tlv("01", formatPixKeyForPayload(input.pixKeyType, input.pixKey));
  const additionalDataField = tlv("05", sanitizeTxid(input.txid));

  const fields = [
    tlv("00", "01"), // Payload Format Indicator
    tlv("01", "11"), // Point of Initiation Method — estático, valor fixo por transação
    tlv("26", merchantAccountInfo), // Merchant Account Information (Pix)
    tlv("52", MERCHANT_CATEGORY_CODE),
    tlv("53", TRANSACTION_CURRENCY_BRL),
    tlv("54", input.amount.toFixed(2)),
    tlv("58", COUNTRY_CODE),
    tlv("59", sanitizeMerchantText(input.recipientName, MERCHANT_NAME_MAX_LENGTH)),
    tlv("60", sanitizeMerchantText(input.city, MERCHANT_CITY_MAX_LENGTH)),
    tlv("62", additionalDataField), // Additional Data Field Template (txid)
  ].join("");

  const withCrcPlaceholder = `${fields}6304`;
  return `${withCrcPlaceholder}${crc16ccitt(withCrcPlaceholder)}`;
}
