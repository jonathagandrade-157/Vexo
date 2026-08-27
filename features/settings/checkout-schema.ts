import { z } from "zod";

/**
 * Fase D1 — fundação do modelo de recebimento de pedidos. Arquivo
 * separado de `appearance-schema.ts`/`schema.ts` pelo mesmo motivo de
 * sempre (cada domínio de configuração tem seu próprio schema, nunca
 * misturado). Os 3 valores exatos pedidos, nenhum a mais.
 */

export const CHECKOUT_MODES = ["vexo", "whatsapp", "both"] as const;
export type CheckoutMode = (typeof CHECKOUT_MODES)[number];

export const CHECKOUT_MODE_LABELS: Record<CheckoutMode, string> = {
  vexo: "Checkout VEXO",
  whatsapp: "WhatsApp",
  both: "VEXO + WhatsApp",
};

export const CHECKOUT_MODE_DESCRIPTIONS: Record<CheckoutMode, string> = {
  vexo: "O cliente finaliza o pagamento pela loja, sem sair do site.",
  whatsapp: "O cliente monta o pedido e ele é enviado para o WhatsApp da loja.",
  both: "A loja disponibiliza os dois caminhos para o cliente escolher.",
};

export const checkoutModeSchema = z.object({
  checkoutMode: z.enum(CHECKOUT_MODES, { message: "Selecione uma opção válida." }),
});

export type CheckoutModeInput = z.infer<typeof checkoutModeSchema>;

export interface CheckoutModeActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<keyof CheckoutModeInput, string>>;
}

export const initialCheckoutModeState: CheckoutModeActionState = { status: "idle" };

/** Type guard para um valor lido do banco (`tenants.checkout_mode`, `text`) — nunca confiado como `CheckoutMode` sem checar, mesmo com o CHECK constraint do banco garantindo isso na prática. */
export function isCheckoutMode(value: unknown): value is CheckoutMode {
  return typeof value === "string" && (CHECKOUT_MODES as readonly string[]).includes(value);
}
