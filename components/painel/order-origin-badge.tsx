import { ORDER_SOURCE_LABELS, type OrderSource } from "@/features/orders/schema";

const ORIGIN_STYLES: Record<OrderSource, string> = {
  vexo_checkout: "bg-emerald-500/10 text-emerald-400",
  whatsapp: "bg-purple-500/10 text-purple-400",
};

const ORIGIN_DOT: Record<OrderSource, string> = {
  vexo_checkout: "🟢",
  whatsapp: "🟣",
};

/** Fase D2-B.3 — de onde o pedido veio (auditoria §5): hoje o painel não distinguia checkout VEXO de WhatsApp em lugar nenhum. */
export function OrderOriginBadge({ source }: { source: OrderSource }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-label text-label-sm ${ORIGIN_STYLES[source]}`}>
      <span aria-hidden="true">{ORIGIN_DOT[source]}</span>
      {ORDER_SOURCE_LABELS[source]}
    </span>
  );
}
