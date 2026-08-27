import { z } from "zod";

import { BRAZILIAN_STATES } from "@/lib/br/states";

const emptyToUndefined = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);

/**
 * Fase D2-B.2 — endereço/origem da loja (auditoria: fonte única para PIX
 * Merchant City/entrega própria/Melhor Envio, nunca `pix_recipient_city`
 * nem `tenants.city` isolados). Todos os campos são opcionais nesta fase
 * — não há um "endereco_enabled" (diferente de PIX/checkout_mode): a loja
 * pode salvar um endereço parcial (ex.: só CEP e cidade). A única exigência
 * de completude concreta é cruzada com PIX (`address_city` obrigatória
 * quando `pix_enabled=true`), aplicada em `pix-actions.ts` + CHECK do banco
 * (migration 084) — nunca aqui.
 *
 * `number`/`complement` nunca vêm do autofill de CEP (`lib/address/
 * cep-lookup.ts` não devolve isso) — sempre digitados pelo lojista.
 * `city` é validada só por tamanho/formato — mantém acentos (exibição/
 * cadastro); a sanitização exigida pelo padrão EMV do BR Code acontece só
 * na geração do payload PIX (fase futura), nunca aqui.
 */
export const storeAddressSchema = z.object({
  zip: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .refine((v) => v.replace(/\D/g, "").length === 8, "CEP inválido")
      .transform((v) => v.replace(/\D/g, ""))
      .optional(),
  ),
  street: z.preprocess(emptyToUndefined, z.string().trim().max(200, "Endereço muito longo").optional()),
  number: z.preprocess(emptyToUndefined, z.string().trim().max(20, "Número inválido").optional()),
  complement: z.preprocess(emptyToUndefined, z.string().trim().max(100, "Complemento muito longo").optional()),
  neighborhood: z.preprocess(emptyToUndefined, z.string().trim().max(100, "Bairro muito longo").optional()),
  city: z.preprocess(emptyToUndefined, z.string().trim().max(100, "Cidade muito longa").optional()),
  state: z.preprocess(emptyToUndefined, z.enum(BRAZILIAN_STATES, { message: "Estado inválido" }).optional()),
});

export type StoreAddressInput = z.infer<typeof storeAddressSchema>;

export interface StoreAddressActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<keyof StoreAddressInput, string>>;
}

export const initialStoreAddressState: StoreAddressActionState = { status: "idle" };
