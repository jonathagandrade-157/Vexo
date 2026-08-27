import { z } from "zod";

import { REQUESTED_PAYMENT_METHODS, type RequestedPaymentMethod } from "@/lib/whatsapp/message";
import { checkoutSchema, type CheckoutInput } from "./schema";

export { REQUESTED_PAYMENT_METHODS, type RequestedPaymentMethod };

const emptyToUndefined = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);

/**
 * Fase D2-B (revisão final). Mesmos campos de `checkoutSchema`
 * (identificação/endereço/frete — reutilizados, nunca reescritos) mais:
 *
 * - `paymentPreference`: obrigatória, só os 3 valores fechados (pix/cash/
 *   card) — nunca "combinar com a loja"/texto livre.
 * - `cashChangeFor`: só relevante quando `paymentPreference === 'cash'` e
 *   o cliente pediu troco (campo "Troco para quanto?"). Ausente/vazio =
 *   sem troco. A Action (`whatsapp-actions.ts`) ignora este campo por
 *   completo quando `paymentPreference !== 'cash'` — nunca é lido do
 *   navegador como autoridade em nenhum caso (a validação real, contra o
 *   total de verdade, é sempre feita no servidor antes de criar o
 *   pedido).
 *
 * Nunca inclui `order_source`/`payment_channel`/telefone ou chave PIX de
 * destino — esses são decididos só pelo servidor (`whatsapp-actions.ts`),
 * nunca por um campo de formulário.
 */
export const whatsappCheckoutSchema = checkoutSchema.extend({
  paymentPreference: z.enum(REQUESTED_PAYMENT_METHODS, { message: "Selecione uma forma de pagamento." }),
  cashChangeFor: z.preprocess(emptyToUndefined, z.coerce.number().positive("Informe um valor válido").optional()),
});

export type WhatsappCheckoutInput = CheckoutInput & {
  paymentPreference: RequestedPaymentMethod;
  cashChangeFor?: number;
};

export interface CheckoutWhatsappActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<keyof WhatsappCheckoutInput, string>>;
}

export const initialCheckoutWhatsappState: CheckoutWhatsappActionState = { status: "idle" };
