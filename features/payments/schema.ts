/** Definido aqui (não em actions.ts) — mesmo motivo de sempre (bug de "use server" com export não-função, Etapa 5). */
export interface PaymentConnectionActionState {
  status: "idle" | "error" | "success";
  message?: string;
}

export const initialPaymentConnectionState: PaymentConnectionActionState = { status: "idle" };
