import { z } from "zod";

import { normalizeBrazilianPhone } from "@/lib/whatsapp/phone";

/**
 * Fase D2-B.1 — "WhatsApp para pedidos" (`/painel/configuracoes/pedidos`).
 * Validação reaproveita `normalizeBrazilianPhone()` por completo — nunca
 * uma segunda regra de formato/DDD/comprimento (essa checagem já existe,
 * já é testada, e é a mesma que decide se `getWhatsappOrderLink` consegue
 * montar o link do pedido). Um número só passa aqui se
 * `normalizeBrazilianPhone()` conseguir normalizá-lo — o valor de saída
 * do schema já é o normalizado (`5511999999999`), nunca o texto bruto
 * digitado, então `whatsapp-actions.ts` nunca precisa (nem deve) chamar
 * o helper de novo.
 */
export const whatsappSettingsSchema = z.object({
  whatsappPhone: z
    .string()
    .trim()
    .min(1, "Informe o número do WhatsApp.")
    .transform((value, ctx) => {
      const normalized = normalizeBrazilianPhone(value);
      if (!normalized) {
        ctx.addIssue({
          code: "custom",
          message: "Número de WhatsApp inválido. Informe um número brasileiro válido, com DDD.",
        });
        return z.NEVER;
      }
      return normalized;
    }),
});

export type WhatsappSettingsInput = z.infer<typeof whatsappSettingsSchema>;

export interface WhatsappSettingsActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<keyof WhatsappSettingsInput, string>>;
}

export const initialWhatsappSettingsState: WhatsappSettingsActionState = { status: "idle" };
