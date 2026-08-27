import { z } from "zod";

import { REQUESTED_PAYMENT_METHOD_LABELS, REQUESTED_PAYMENT_METHODS, type RequestedPaymentMethod } from "@/lib/whatsapp/message";

export { REQUESTED_PAYMENT_METHOD_LABELS, REQUESTED_PAYMENT_METHODS, type RequestedPaymentMethod };

/**
 * Fase D2-B.3 — origem/canal/status de pagamento do pedido, para o
 * painel exibir claramente de onde cada pedido veio (auditoria: hoje o
 * painel não mostra nada disso). Mesmos vocabulários já em produção
 * desde a Fase D2-B (migrations 20260817220079/080) — nada novo é
 * inventado aqui, só exposto na UI.
 */
export const ORDER_SOURCES = ["vexo_checkout", "whatsapp"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];
export const ORDER_SOURCE_LABELS: Record<OrderSource, string> = {
  vexo_checkout: "Checkout VEXO",
  whatsapp: "WhatsApp",
};

export const PAYMENT_CHANNELS = ["gateway", "external"] as const;
export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];

/**
 * Rótulo único de "forma de pagamento" para a UI do painel — junta os
 * dois eixos reais (payment_channel/requested_payment_method) do jeito
 * que o lojista pensa ("Mercado Pago" vs. "PIX"/"Dinheiro"/"Cartão").
 * Função pura, só formatação — nunca decide nada, nunca grava nada.
 */
export function getPaymentMethodLabel(order: {
  payment_channel: PaymentChannel;
  requested_payment_method: RequestedPaymentMethod | null;
}): string {
  if (order.payment_channel === "gateway") return "Mercado Pago";
  return order.requested_payment_method ? REQUESTED_PAYMENT_METHOD_LABELS[order.requested_payment_method] : "Externo";
}

/** Mesma lista da migration 20260817220079 (PENDING/APPROVED/REJECTED/CANCELLED/REFUNDED/EXTERNAL) — nunca um valor novo inventado aqui. */
export const PAYMENT_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED", "REFUNDED", "EXTERNAL"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: "Aguardando",
  APPROVED: "Pago",
  REJECTED: "Recusado",
  CANCELLED: "Cancelado",
  REFUNDED: "Reembolsado",
  EXTERNAL: "Pagamento externo",
};

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

/**
 * Fase D2-B.3 — confirmação manual de pagamento externo. `reason` é
 * obrigatório (mesma exigência da função no servidor,
 * `confirm_external_payment`, migration 20260817220085) — a Action só
 * devolve uma mensagem amigável antes de chamar o banco, a autoridade
 * real continua sendo a RPC.
 */
export const confirmExternalPaymentSchema = z.object({
  reason: z.string().trim().min(1, "Informe o motivo da confirmação.").max(500, "Máximo de 500 caracteres."),
});

export type ConfirmExternalPaymentInput = z.infer<typeof confirmExternalPaymentSchema>;

export interface ConfirmExternalPaymentActionState {
  status: "idle" | "error" | "success";
  message?: string;
}

export const initialConfirmExternalPaymentState: ConfirmExternalPaymentActionState = { status: "idle" };

/**
 * Filtros novos da lista de pedidos (auditoria D2-B.3 §10). "Pagamento"
 * mistura dois eixos já existentes (payment_channel/requested_payment_method)
 * numa única lista de opções porque é assim que o lojista pensa sobre
 * pagamento — a tradução para a query real acontece em `features/orders/
 * data.ts`, nunca um valor novo gravado no banco.
 */
export const ORDER_PAYMENT_FILTERS = ["mercadopago", "pix", "cash", "card"] as const;
export type OrderPaymentFilter = (typeof ORDER_PAYMENT_FILTERS)[number];
export const ORDER_PAYMENT_FILTER_LABELS: Record<OrderPaymentFilter, string> = {
  mercadopago: "Mercado Pago",
  pix: "PIX",
  cash: "Dinheiro",
  card: "Cartão",
};

export const ORDER_PERIOD_FILTERS = ["today", "7d", "30d"] as const;
export type OrderPeriodFilter = (typeof ORDER_PERIOD_FILTERS)[number];
export const ORDER_PERIOD_FILTER_LABELS: Record<OrderPeriodFilter, string> = {
  today: "Hoje",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
};
