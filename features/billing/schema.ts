import { z } from "zod";

/**
 * Etapa 20.2.6 — entrada do fluxo de 1ª assinatura de billing. Mesmo
 * vocabulário exato de `subscriptions.billing_cycle`/`payment_method`
 * (Etapa 20.2.4) — nunca diverge do `CHECK` do banco.
 */
export const startBillingSubscriptionSchema = z.object({
  planId: z.string().uuid("Selecione um plano válido."),
  cycle: z.enum(["monthly", "yearly"], { message: "Selecione mensal ou anual." }),
  paymentMethod: z.enum(["pix", "card"], { message: "Selecione Pix ou cartão." }),
});

export type StartBillingSubscriptionInput = z.infer<typeof startBillingSubscriptionSchema>;

export interface StartBillingSubscriptionInvoiceView {
  id: string;
  gatewayInvoiceId: string | null;
  amount: number;
  dueAt: string;
  billingType: string;
  status: string;
}

export interface StartBillingSubscriptionActionState {
  status: "idle" | "success" | "error";
  message?: string;
  invoice?: StartBillingSubscriptionInvoiceView;
}

export const initialStartBillingSubscriptionState: StartBillingSubscriptionActionState = { status: "idle" };
