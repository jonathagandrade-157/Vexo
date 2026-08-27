import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ConfirmExternalPaymentDialog } from "@/components/painel/confirm-external-payment-dialog";
import { OrderOriginBadge } from "@/components/painel/order-origin-badge";
import { OrderStatusBadge } from "@/components/painel/order-status-badge";
import { OrderStatusForm } from "@/components/painel/order-status-form";
import { PanelEmptyState } from "@/components/painel/panel-empty-state";
import { PaymentStatusBadge } from "@/components/painel/payment-status-badge";
import { getCurrentMembership } from "@/features/painel/current-tenant";
import { getCustomerWhatsappLink } from "@/features/orders/customer-whatsapp-link";
import { getOrderDetail } from "@/features/orders/data";
import {
  getPaymentMethodLabel,
  ORDER_SOURCE_LABELS,
  REQUESTED_PAYMENT_METHOD_LABELS,
  type PaymentStatus,
} from "@/features/orders/schema";
import { formatPrice } from "@/features/products/format-price";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Detalhe do pedido — VEXO" };

interface PageProps {
  params: Promise<{ id: string }>;
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  ORDER_CREATED: "Pedido criado",
  ORDER_STATUS_CHANGED: "Status alterado",
  ORDER_PAYMENT_CONFIRMED: "Pagamento confirmado",
};

/**
 * Fase D2-B.3 — texto do bloco de pagamento, condicional ao método/canal.
 * Nunca afirma "aprovado/confirmado" para um pagamento externo que ainda
 * não foi confirmado manualmente pelo lojista — o pedido continua
 * `payment_status='EXTERNAL'` até essa confirmação existir.
 */
function externalPaymentCopy(method: "pix" | "cash" | "card" | null, status: string): string | null {
  if (status === "APPROVED") return "Pagamento confirmado.";
  if (method === "pix") return "Pagamento externo — aguardando confirmação.";
  if (method === "card") return "Pagamento informado pelo cliente — confirmação manual necessária.";
  if (method === "cash") return "Pagamento em dinheiro — aguardando confirmação.";
  return "Pagamento externo — aguardando confirmação.";
}

/** `/painel/pedidos/[id]` (Etapa 13, estendido na Fase D2-B.3) — detalhe real, itens/frete/pagamento sempre a partir do snapshot já persistido (order_items, orders.shipping_*), nunca reconstruído a partir do catálogo atual. */
export default async function PedidoDetalhePage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const membership = await getCurrentMembership();
  if (!membership) redirect("/sem-loja");
  const { tenant } = membership;

  const [{ data: canView }, { data: canUpdate }, { data: canViewPayment }] = await Promise.all([
    supabase.rpc("has_permission", { p_tenant_id: tenant.id, p_permission_key: "orders.view" }),
    supabase.rpc("has_permission", { p_tenant_id: tenant.id, p_permission_key: "orders.update" }),
    supabase.rpc("has_permission", { p_tenant_id: tenant.id, p_permission_key: "payments.view" }),
  ]);

  if (!canView) {
    return (
      <div className="mx-auto flex max-w-[960px] flex-col gap-8">
        <h1 className="font-headline text-headline-md text-on-surface">Pedido</h1>
        <PanelEmptyState description="Sua função não tem acesso à visualização de pedidos." icon="lock" title="Sem permissão" />
      </div>
    );
  }

  // id é sempre escopado por (tenant_id, id) dentro de getOrderDetail —
  // um pedido de outro tenant nunca é encontrado, mesmo com o id certo
  // (tenant hopping bloqueado por construção, não só por RLS).
  const order = await getOrderDetail(tenant.id, id);
  if (!order) notFound();

  let payment: { provider: string; status: string; method: string | null; paid_at: string | null } | null = null;
  if (canViewPayment && order.payment_channel === "gateway") {
    const { data } = await supabase
      .from("payments")
      .select("provider, status, method, paid_at")
      .eq("tenant_id", tenant.id)
      .eq("order_id", id)
      .maybeSingle();
    payment = data;
  }

  // Fase D2-B.3 §1 — decisão de produto: interseção orders.update E
  // payments.view, nunca uma OU outra sozinha. O botão só aparece quando
  // a confirmação ainda faz sentido (external + EXTERNAL) — a função no
  // servidor (confirm_external_payment) reexige tudo isso de novo.
  const canConfirmPayment = Boolean(canUpdate) && Boolean(canViewPayment);
  const showConfirmButton = order.payment_channel === "external" && order.payment_status === "EXTERNAL" && canConfirmPayment;

  const whatsappLink = getCustomerWhatsappLink(order.order_number, order.customer_name, order.customer_phone);

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link className="w-fit font-label text-label-sm text-on-surface-variant hover:text-primary" href="/painel/pedidos">
          ← Pedidos
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-headline text-headline-md text-on-surface">Pedido {order.order_number}</h1>
            <p className="mt-1 font-body text-body-sm text-on-surface-variant">
              {new Date(order.created_at).toLocaleString("pt-BR")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <OrderOriginBadge source={order.order_source} />
            <OrderStatusBadge status={order.status} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <section className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
            <h2 className="mb-4 font-headline text-headline-sm text-on-surface">Itens do pedido</h2>
            <div className="flex flex-col gap-3">
              {order.items.map((item) => (
                <div className="flex items-start justify-between gap-3" key={item.id}>
                  <div className="min-w-0">
                    <p className="truncate font-body text-body-sm text-on-surface">{item.product_name}</p>
                    <p className="font-body text-body-sm text-on-surface-variant">
                      {item.quantity} × {formatPrice(item.unit_price)}
                    </p>
                  </div>
                  <p className="whitespace-nowrap font-label text-label-sm text-on-surface">{formatPrice(item.subtotal)}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-col gap-1.5 border-t border-outline-variant/20 pt-4 font-body text-body-sm text-on-surface-variant">
              <div className="flex items-center justify-between">
                <span>Subtotal</span>
                <span>{formatPrice(order.subtotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Frete</span>
                <span>{order.shipping_total === 0 ? "Grátis" : formatPrice(order.shipping_total)}</span>
              </div>
              {order.discount_total > 0 ? (
                <div className="flex items-center justify-between">
                  <span>Desconto</span>
                  <span>-{formatPrice(order.discount_total)}</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between pt-2 font-label text-label-lg text-on-surface">
                <span>Total</span>
                <span>{formatPrice(order.total)}</span>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
            <h2 className="mb-4 font-headline text-headline-sm text-on-surface">Cliente e entrega</h2>
            <dl className="grid grid-cols-1 gap-3 font-body text-body-sm sm:grid-cols-2">
              <div>
                <dt className="text-on-surface-variant">Origem</dt>
                <dd className="text-on-surface">{ORDER_SOURCE_LABELS[order.order_source]}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant">Nome</dt>
                <dd className="text-on-surface">{order.customer_name}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant">E-mail</dt>
                <dd className="text-on-surface">{order.customer_email}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant">Telefone</dt>
                <dd className="flex flex-wrap items-center gap-2 text-on-surface">
                  {order.customer_phone}
                  {whatsappLink ? (
                    <a
                      className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/50 px-2.5 py-1 font-label text-label-sm text-on-surface transition-colors hover:border-primary/50"
                      href={whatsappLink}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      <span className="material-symbols-outlined text-[16px]">chat</span>
                      Conversar no WhatsApp
                    </a>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-on-surface-variant">Modalidade de frete</dt>
                <dd className="text-on-surface">
                  {order.shipping_method
                    ? `${order.shipping_method}${order.shipping_estimated_days ? ` — até ${order.shipping_estimated_days} dia(s)` : ""}`
                    : "Não informada"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-on-surface-variant">Endereço de entrega</dt>
                <dd className="text-on-surface">
                  {order.shipping_address.street}, {order.shipping_address.number}
                  {order.shipping_address.complement ? ` — ${order.shipping_address.complement}` : ""}
                  <br />
                  {order.shipping_address.neighborhood}, {order.shipping_address.city} - {order.shipping_address.state}
                  <br />
                  CEP {order.shipping_address.zip}
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
            <h2 className="mb-4 font-headline text-headline-sm text-on-surface">Histórico</h2>
            {order.history.length === 0 ? (
              <p className="font-body text-body-sm text-on-surface-variant">Nenhum evento registrado ainda.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {order.history.map((entry) => (
                  <li className="flex flex-col gap-0.5 border-l-2 border-outline-variant/30 pl-3" key={entry.id}>
                    <span className="font-label text-label-sm text-on-surface">
                      {AUDIT_ACTION_LABELS[entry.action] ?? entry.action}
                      {entry.after && typeof entry.after.status === "string" ? ` — ${entry.after.status}` : ""}
                    </span>
                    <span className="font-body text-body-sm text-on-surface-variant">
                      {new Date(entry.created_at).toLocaleString("pt-BR")}
                    </span>
                    {entry.after && typeof entry.after.note === "string" ? (
                      <span className="font-body text-body-sm text-on-surface-variant">Nota: {entry.after.note}</span>
                    ) : null}
                    {entry.reason ? (
                      <span className="font-body text-body-sm text-on-surface-variant">Motivo: {entry.reason}</span>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <section className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
            <h2 className="mb-4 font-headline text-headline-sm text-on-surface">Pagamento</h2>
            <dl className="flex flex-col gap-2 font-body text-body-sm">
              <div className="flex items-center justify-between">
                <dt className="text-on-surface-variant">Método</dt>
                <dd className="text-on-surface">{getPaymentMethodLabel(order)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-on-surface-variant">Canal</dt>
                <dd className="text-on-surface">{order.payment_channel === "gateway" ? "Gateway" : "Externo"}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-on-surface-variant">Status</dt>
                <dd>
                  <PaymentStatusBadge status={order.payment_status as PaymentStatus} />
                </dd>
              </div>

              {order.payment_channel === "external" ? (
                <p className="mt-1 font-body text-body-sm text-on-surface-variant">
                  {externalPaymentCopy(order.requested_payment_method, order.payment_status)}
                </p>
              ) : null}

              {order.requested_payment_method === "cash" ? (
                <div className="mt-2 flex flex-col gap-1 rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-on-surface-variant">Total</span>
                    <span className="text-on-surface">{formatPrice(order.total)}</span>
                  </div>
                  {order.cash_change_for !== null ? (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-on-surface-variant">Cliente paga</span>
                        <span className="text-on-surface">{formatPrice(order.cash_change_for)}</span>
                      </div>
                      <div className="flex items-center justify-between font-label">
                        <span className="text-on-surface-variant">Troco</span>
                        <span className="text-on-surface">{formatPrice(order.cash_change_for - order.total)}</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-on-surface-variant">Sem troco — cliente paga o valor exato.</p>
                  )}
                </div>
              ) : null}

              {order.requested_payment_method === "card" && order.payment_channel === "external" ? (
                <p className="mt-1 font-body text-body-sm text-on-surface-variant">
                  Preferência informada: {REQUESTED_PAYMENT_METHOD_LABELS.card}. A VEXO não processa cartão neste fluxo.
                </p>
              ) : null}

              {payment ? (
                <>
                  <div className="mt-2 flex items-center justify-between border-t border-outline-variant/20 pt-2">
                    <dt className="text-on-surface-variant">Provedor</dt>
                    <dd className="text-on-surface">{payment.provider}</dd>
                  </div>
                  {payment.method ? (
                    <div className="flex items-center justify-between">
                      <dt className="text-on-surface-variant">Método (gateway)</dt>
                      <dd className="text-on-surface">{payment.method}</dd>
                    </div>
                  ) : null}
                  {payment.paid_at ? (
                    <div className="flex items-center justify-between">
                      <dt className="text-on-surface-variant">Pago em</dt>
                      <dd className="text-on-surface">{new Date(payment.paid_at).toLocaleString("pt-BR")}</dd>
                    </div>
                  ) : null}
                </>
              ) : null}
            </dl>

            {showConfirmButton ? (
              <div className="mt-4">
                <ConfirmExternalPaymentDialog orderId={order.id} />
              </div>
            ) : null}
          </section>

          {order.internal_note ? (
            <section className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
              <h2 className="mb-2 font-headline text-headline-sm text-on-surface">Nota interna</h2>
              <p className="font-body text-body-sm text-on-surface-variant">{order.internal_note}</p>
              <p className="mt-2 font-body text-body-sm text-outline-variant">Visível só para a equipe da loja.</p>
            </section>
          ) : null}

          {canUpdate ? (
            <section className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
              <h2 className="mb-4 font-headline text-headline-sm text-on-surface">Avançar status</h2>
              <OrderStatusForm currentStatus={order.status} orderId={order.id} />
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
