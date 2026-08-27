import { z } from "zod";

import { BRAZILIAN_STATES } from "@/lib/br/states";

/** Fase D2-B.2 — movido para `lib/br/states.ts` (reaproveitado também pelo endereço da loja). Re-exportado aqui para não quebrar quem já importava daqui (components/storefront/checkout-form.tsx). */
export { BRAZILIAN_STATES };

const emptyToUndefined = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);

/**
 * D3.1 §7: os 6 campos de endereço de entrega ficam opcionais aqui (só na
 * camada Zod/UX) porque retirada na loja não pede endereço do cliente.
 * Isto NUNCA é a decisão final: o Action sempre resolve a modalidade
 * (`shipping_methods.type`) no servidor antes de decidir se o endereço é
 * obrigatório, e descarta esses campos por completo quando a modalidade
 * resolvida é `pickup` — mesmo padrão já usado para `cash_change_for`
 * quando `paymentPreference !== 'cash'` (ignorado, nunca só "validado e
 * descartado depois").
 */
export const checkoutSchema = z.object({
  customerName: z.string().trim().min(2, "Informe seu nome completo").max(120),
  customerEmail: z.string().trim().toLowerCase().email("E-mail inválido"),
  customerPhone: z
    .string()
    .trim()
    .refine((v) => v.replace(/\D/g, "").length >= 10, "Telefone inválido"),
  zip: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .refine((v) => v.replace(/\D/g, "").length === 8, "CEP inválido")
      .transform((v) => v.replace(/\D/g, ""))
      .optional(),
  ),
  street: z.preprocess(emptyToUndefined, z.string().trim().min(2, "Informe o endereço").max(200).optional()),
  number: z.preprocess(emptyToUndefined, z.string().trim().min(1, "Informe o número").max(20).optional()),
  complement: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  neighborhood: z.preprocess(emptyToUndefined, z.string().trim().min(2, "Informe o bairro").max(100).optional()),
  city: z.preprocess(emptyToUndefined, z.string().trim().min(2, "Informe a cidade").max(100).optional()),
  state: z.preprocess(emptyToUndefined, z.enum(BRAZILIAN_STATES, { message: "Selecione um estado" }).optional()),
  // Opcionais (Etapa 12) — só presentes quando a loja tem entrega
  // habilitada e o cliente selecionou uma modalidade no checkout.
  // Nunca a autoridade final do preço: apenas o que o cliente viu na
  // tela, revalidado no servidor antes de aplicar (features/shipping).
  shippingMethodId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
  shippingPrice: z.preprocess(emptyToUndefined, z.coerce.number().min(0).optional()),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

/**
 * D3.1 §7: um Server Action só pode montar `shipping_address` quando os 6
 * campos vieram preenchidos — usado depois de saber que a modalidade
 * resolvida no servidor não é `pickup`. Nomeado a partir do próprio
 * schema (não duplicado em cada Action) para as duas Actions de checkout
 * (VEXO e WhatsApp) ficarem sempre de acordo sobre o que é "endereço
 * completo".
 */
export function isAddressComplete(
  data: CheckoutInput,
): data is CheckoutInput & { zip: string; street: string; number: string; neighborhood: string; city: string; state: string } {
  return Boolean(data.zip && data.street && data.number && data.neighborhood && data.city && data.state);
}

/** Definido aqui (não em actions.ts) — mesmo motivo de sempre (bug de "use server" com export não-função, Etapa 5). */
export interface CheckoutActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<keyof CheckoutInput, string>>;
}

export const initialCheckoutState: CheckoutActionState = { status: "idle" };

/**
 * Fase D2-B — movida para cá (era privada em `actions.ts`) para ser
 * reaproveitada também por `whatsapp-actions.ts`: as duas Actions chamam
 * a mesma RPC (`create_order_from_cart`) e devem traduzir os mesmos erros
 * conhecidos da mesma forma — duas cópias divergentes seriam um risco real
 * (uma delas podendo vazar texto bruto do Postgres que a outra já trata).
 * Nunca expõe o texto bruto do erro Postgres ao visitante.
 */
export function friendlyCheckoutError(message: string): string {
  if (message.includes("cart not found") || message.includes("cart is empty")) {
    return "Seu carrinho está vazio ou não foi encontrado. Volte para a loja e adicione produtos novamente.";
  }
  if (message.includes("store is not available")) {
    return "Esta loja não está disponível no momento.";
  }
  const inactiveProduct = /^product (.+) is no longer available$/.exec(message);
  if (inactiveProduct) {
    return `O produto "${inactiveProduct[1]}" não está mais disponível. Volte ao carrinho para removê-lo e tente novamente.`;
  }
  return "Não foi possível finalizar o pedido. Tente novamente.";
}
