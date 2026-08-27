/**
 * Fase D2-B.2 — movido de `features/settings/pix-schema.ts` para `lib/`:
 * passou a ser usado também por `lib/pix/payload.ts` (formatação da chave
 * exigida pelo payload EMV difere por tipo — telefone precisa do prefixo
 * "+" no payload, nunca no valor salvo/exibido), e `lib/` nunca importa de
 * `features/` (mesma regra já aplicada a `lib/whatsapp/message.ts` e
 * `lib/br/states.ts`).
 */
export const PIX_KEY_TYPES = ["cpf_cnpj", "email", "phone", "random"] as const;
export type PixKeyType = (typeof PIX_KEY_TYPES)[number];

export const PIX_KEY_TYPE_LABELS: Record<PixKeyType, string> = {
  cpf_cnpj: "CPF/CNPJ",
  email: "E-mail",
  phone: "Telefone",
  random: "Chave aleatória",
};
