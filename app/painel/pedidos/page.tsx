import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OrderStatusBadge } from "@/components/painel/order-status-badge";
import { PanelEmptyState } from "@/components/painel/panel-empty-state";
import { getCurrentMembership } from "@/features/painel/current-tenant";
import { formatPrice } from "@/features/products/format-price";
import { listOrders } from "@/features/orders/data";
import { ORDER_STATUS_LABELS, ORDER_STATUSES, type OrderStatus } from "@/features/orders/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Pedidos — VEXO" };

interface PageProps {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}

function buildHref(base: { q?: string; status?: string; page?: number }): string {
  const params = new URLSearchParams();
  if (base.q) params.set("q", base.q);
  if (base.status) params.set("status", base.status);
  if (base.page && base.page > 1) params.set("page", String(base.page));
  const qs = params.toString();
  return qs ? `/painel/pedidos?${qs}` : "/painel/pedidos";
}

/** Substitui o ComingSoon (Etapa 5) por dados reais — `/painel/pedidos` (Etapa 13). Mesmo padrão de tabela/cards de `/painel/produtos`, sem novo design system. */
export default async function PedidosPage({ searchParams }: PageProps) {
  const { q, status: statusParam, page: pageParam } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const membership = await getCurrentMembership();
  if (!membership) redirect("/sem-loja");
  const { tenant } = membership;

  const { data: canView } = await supabase.rpc("has_permission", {
    p_tenant_id: tenant.id,
    p_permission_key: "orders.view",
  });

  if (!canView) {
    return (
      <div className="flex flex-col gap-8">
        <h1 className="font-headline text-headline-md text-on-surface">Pedidos</h1>
        <PanelEmptyState description="Sua função não tem acesso à visualização de pedidos." icon="lock" title="Sem permissão" />
      </div>
    );
  }

  const page = pageParam ? Number(pageParam) : 1;
  const validStatus = statusParam && (ORDER_STATUSES as readonly string[]).includes(statusParam) ? statusParam : undefined;
  const { orders, total, pageCount } = await listOrders(tenant.id, {
    search: q,
    status: validStatus,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  });

  const hasFilters = Boolean(q || validStatus);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-headline text-headline-md text-on-surface">Pedidos</h1>
        <p className="mt-1 font-body text-body-md text-on-surface-variant">
          {total === 0 ? "Nenhum pedido encontrado." : `${total} pedido(s) encontrado(s).`}
        </p>
      </div>

      <form className="flex flex-col gap-3 sm:flex-row sm:items-end" method="GET">
        <div className="flex-1">
          <label className="mb-1.5 block font-label text-label-md uppercase text-on-surface-variant" htmlFor="q">
            Buscar
          </label>
          <input
            className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
            defaultValue={q ?? ""}
            id="q"
            name="q"
            placeholder="Número do pedido, cliente ou e-mail"
            type="text"
          />
        </div>
        <div className="sm:w-56">
          <label className="mb-1.5 block font-label text-label-md uppercase text-on-surface-variant" htmlFor="status">
            Status
          </label>
          <select
            className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
            defaultValue={validStatus ?? ""}
            id="status"
            name="status"
          >
            <option value="">Todos os status</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <button
          className="rounded-lg bg-primary-container px-5 py-2.5 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6]"
          type="submit"
        >
          Filtrar
        </button>
        {hasFilters ? (
          <Link
            className="rounded-lg border border-outline-variant/50 px-5 py-2.5 text-center font-label text-label-md text-on-surface-variant transition-colors hover:border-primary/50"
            href="/painel/pedidos"
          >
            Limpar
          </Link>
        ) : null}
      </form>

      {orders.length === 0 ? (
        <PanelEmptyState
          description={hasFilters ? "Nenhum pedido corresponde à busca/filtro atual." : "Sua loja ainda não recebeu nenhum pedido."}
          icon="shopping_cart"
          title="Nenhum pedido encontrado"
        />
      ) : (
        <>
          {/* Desktop: tabela */}
          <div className="hidden overflow-hidden rounded-xl border border-surface-container-highest bg-[#121212] md:block">
            <table className="w-full min-w-[860px] border-collapse text-left">
              <thead>
                <tr className="border-b border-surface-container-highest bg-surface-container-low/50">
                  <th className="p-4 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Pedido</th>
                  <th className="p-4 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Cliente</th>
                  <th className="p-4 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Data</th>
                  <th className="p-4 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Total</th>
                  <th className="p-4 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Status</th>
                  <th className="p-4 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Pagamento</th>
                  <th className="p-4 text-right font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-highest">
                {orders.map((order) => (
                  <tr className="transition-colors hover:bg-[#1E1E1E]/50" key={order.id}>
                    <td className="p-4 font-label text-label-md text-on-surface">{order.order_number}</td>
                    <td className="p-4">
                      <div className="font-body text-body-sm text-on-surface">{order.customer_name}</div>
                      <div className="font-body text-body-sm text-on-surface-variant">{order.customer_email}</div>
                    </td>
                    <td className="p-4 font-body text-body-sm text-on-surface-variant">
                      {new Date(order.created_at).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="p-4 font-label text-label-md text-on-surface">{formatPrice(order.total)}</td>
                    <td className="p-4">
                      <OrderStatusBadge status={order.status} />
                    </td>
                    <td className="p-4 font-body text-body-sm text-on-surface-variant">{order.payment_status}</td>
                    <td className="p-4 text-right">
                      <Link
                        className="font-label text-label-sm text-primary transition-colors hover:text-[#8B5CF6]"
                        href={`/painel/pedidos/${order.id}`}
                      >
                        Ver detalhe
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: cards */}
          <div className="flex flex-col gap-3 md:hidden">
            {orders.map((order) => (
              <Link
                className="flex flex-col gap-2 rounded-xl border border-surface-container-highest bg-[#121212] p-4"
                href={`/painel/pedidos/${order.id}`}
                key={order.id}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-label text-label-md text-on-surface">{order.order_number}</span>
                  <OrderStatusBadge status={order.status} />
                </div>
                <div className="font-body text-body-sm text-on-surface-variant">{order.customer_name}</div>
                <div className="flex items-center justify-between">
                  <span className="font-body text-body-sm text-on-surface-variant">
                    {new Date(order.created_at).toLocaleDateString("pt-BR")}
                  </span>
                  <span className="font-label text-label-md text-on-surface">{formatPrice(order.total)}</span>
                </div>
              </Link>
            ))}
          </div>

          {pageCount > 1 ? (
            <div className="flex items-center justify-between">
              <Link
                aria-disabled={page <= 1}
                className={`rounded-lg border border-outline-variant/50 px-4 py-2 font-label text-label-sm text-on-surface-variant transition-colors ${
                  page <= 1 ? "pointer-events-none opacity-40" : "hover:border-primary/50"
                }`}
                href={buildHref({ q, status: validStatus, page: page - 1 })}
              >
                ← Anterior
              </Link>
              <span className="font-body text-body-sm text-on-surface-variant">
                Página {page} de {pageCount}
              </span>
              <Link
                aria-disabled={page >= pageCount}
                className={`rounded-lg border border-outline-variant/50 px-4 py-2 font-label text-label-sm text-on-surface-variant transition-colors ${
                  page >= pageCount ? "pointer-events-none opacity-40" : "hover:border-primary/50"
                }`}
                href={buildHref({ q, status: validStatus, page: page + 1 })}
              >
                Próxima →
              </Link>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
