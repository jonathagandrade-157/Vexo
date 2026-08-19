import { ORDER_STATUS_LABELS, type OrderStatus } from "@/features/orders/schema";

const STATUS_STYLES: Record<OrderStatus, string> = {
  PENDING: "bg-surface-container-highest text-on-surface-variant",
  PAID: "bg-primary/10 text-primary",
  PREPARING: "bg-amber-500/10 text-amber-400",
  SHIPPED: "bg-blue-500/10 text-blue-400",
  DELIVERED: "bg-emerald-500/10 text-emerald-400",
  CANCELLED: "bg-error-container/20 text-error",
};

/** Mesmo padrão visual de "Ativo"/"Inativo" (category-row.tsx) — badge de status, uma cor por estado da máquina de estados (migration 20260817220051). */
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 font-label text-label-sm uppercase ${STATUS_STYLES[status]}`}>
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}
