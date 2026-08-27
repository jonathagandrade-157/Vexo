import { z } from "zod";

import { BRAZILIAN_STATES } from "@/lib/br/states";

/** Fase D2-B.2 — movido para `lib/br/states.ts` (reaproveitado também pelo endereço da loja). Re-exportado aqui para não quebrar quem já importava daqui (components/storefront/checkout-form.tsx). */
export { BRAZILIAN_STATES };

const emptyToUndefined = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);

/** Mesma validação de nome/e-mail/telefone já usada no cadastro do lojista (features/auth/schema.ts, Etapa 3) — não reinventada aqui. */
export const checkoutSchema = z.object({
  customerName: z.string().trim().min(2, "Informe seu nome completo").max(120),
  customerEmail: z.string().trim().toLowerCase().email("E-mail inválido"),
  customerPhone: z
    .string()
    .trim()
    .refine((v) => v.replace(/\D/g, "").length >= 10, "Telefone inválido"),
  zip: z
    .string()
    .trim()
    .refine((v) => v.replace(/\D/g, "").length === 8, "CEP inválido")
    .transform((v) => v.replace(/\D/g, "")),
  street: z.string().trim().min(2, "Informe o endereço").max(200),
  number: z.string().trim().min(1, "Informe o número").max(20),
  complement: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  neighborhood: z.string().trim().min(2, "Informe o bairro").max(100),
  city: z.string().trim().min(2, "Informe a cidade").max(100),
  state: z.enum(BRAZILIAN_STATES, { message: "Selecione um estado" }),
  // Opcionais (Etapa 12) — só presentes quando a loja tem entrega
  // habilitada e o cliente selecionou uma modalidade no checkout.
  // Nunca a autoridade final do preço: apenas o que o cliente viu na
  // tela, revalidado no servidor antes de aplicar (features/shipping).
  shippingMethodId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
  shippingPrice: z.preprocess(emptyToUndefined, z.coerce.number().min(0).optional()),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

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
