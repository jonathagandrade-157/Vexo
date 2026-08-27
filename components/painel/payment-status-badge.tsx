import { PAYMENT_STATUS_LABELS, type PaymentStatus } from "@/features/orders/schema";

const PAYMENT_STATUS_STYLES: Record<PaymentStatus, string> = {
  PENDING: "bg-surface-container-highest text-on-surface-variant",
  APPROVED: "bg-emerald-500/10 text-emerald-400",
  REJECTED: "bg-error-container/20 text-error",
  CANCELLED: "bg-error-container/20 text-error",
  REFUNDED: "bg-amber-500/10 text-amber-400",
  EXTERNAL: "bg-purple-500/10 text-purple-400",
};

/** Fase D2-B.3 — mesmo padrão visual de OrderStatusBadge, mas para payment_status (dimensão separada, nunca misturada com orders.status). */
export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 font-label text-label-sm uppercase ${PAYMENT_STATUS_STYLES[status]}`}>
      {PAYMENT_STATUS_LABELS[status]}
    </span>
  );
}
