/** Definido aqui (não em actions.ts) — mesmo motivo de sempre (bug de "use server" com export não-função, Etapa 5). */
export interface ShippingConnectionActionState {
  status: "idle" | "error" | "success";
  message?: string;
}

export const initialShippingConnectionState: ShippingConnectionActionState = { status: "idle" };
