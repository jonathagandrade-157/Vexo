import { z } from "zod";

/** Mesma lista da máquina de estados do banco (migration 20260817220051) — mantida aqui só para a allowlist Zod da Action, a validação real é sempre a função no servidor. */
export const ORDER_STATUSES = ["PENDING", "PAID", "PREPARING", "SHIPPED", "DELIVERED", "CANCELLED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "Pendente",
  PAID: "Pago",
  PREPARING: "Em preparação",
  SHIPPED: "Enviado",
  DELIVERED: "Entregue",
  CANCELLED: "Cancelado",
};

/**
 * Espelha EXATAMENTE a máquina de estados de `update_order_status`
 * (migration 20260817220051) — usado só para a UI esconder transições
 * inválidas (prompt §3: "a UI pode esconder... mas a segurança NÃO pode
 * depender da UI"). A autoridade real é sempre a função no servidor,
 * que valida de novo e não confia neste mapa nem em nada vindo do
 * cliente.
 */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ["CANCELLED"],
  PAID: ["PREPARING", "CANCELLED"],
  PREPARING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

const emptyToUndefined = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);

export const updateOrderStatusSchema = z.object({
  newStatus: z.enum(ORDER_STATUSES, { message: "Status inválido" }),
  note: z.preprocess(emptyToUndefined, z.string().trim().max(500, "Máximo de 500 caracteres").optional()),
});

export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

export interface UpdateOrderStatusActionState {
  status: "idle" | "error" | "success";
  message?: string;
}

export const initialUpdateOrderStatusState: UpdateOrderStatusActionState = { status: "idle" };
