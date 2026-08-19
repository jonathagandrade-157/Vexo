import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ORDER_STATUSES, type OrderStatus } from "./schema";

const PAGE_SIZE = 20;

export interface OrderListRow {
  id: string;
  order_number: string;
  customer_name: string;
  customer_email: string;
  created_at: string;
  total: number;
  status: OrderStatus;
  payment_status: string;
  shipping_method: string | null;
}

export interface OrderListResult {
  orders: OrderListRow[];
  total: number;
  page: number;
  pageCount: number;
}

/**
 * Sanitiza o termo de busca antes de interpolar em `.or()` (PostgREST):
 * `,` e `(`/`)` têm significado de sintaxe de filtro ali (poderiam
 * confundir a query com condições extras) e `%`/`_` são curingas do
 * `LIKE` — todos tratados como texto literal, nunca sintaxe. Isto não é
 * uma questão de isolamento de tenant (o `.eq("tenant_id", ...)` abaixo
 * é um parâmetro top-level, sempre combinado com AND pelo PostgREST,
 * portanto nunca afetado pelo conteúdo de `.or()`) — é só para a busca
 * se comportar como o lojista espera.
 */
function sanitizeSearchTerm(raw: string): string {
  return raw
    .replace(/[,()]/g, " ")
    .replace(/[%_\\]/g, (c) => `\\${c}`)
    .trim()
    .slice(0, 100);
}

export interface ListOrdersOptions {
  search?: string;
  status?: string;
  page?: number;
}

/** Sempre escopada ao tenant do chamador (defesa em profundidade — RLS de `orders.view`, Etapa 10, já escopa por si só). */
export async function listOrders(tenantId: string, opts: ListOrdersOptions): Promise<OrderListResult> {
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from("orders")
    .select("id, order_number, customer_name, customer_email, created_at, total, status, payment_status, shipping_method", {
      count: "exact",
    })
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (opts.status && (ORDER_STATUSES as readonly string[]).includes(opts.status)) {
    query = query.eq("status", opts.status);
  }

  const search = opts.search?.trim();
  if (search) {
    const term = sanitizeSearchTerm(search);
    if (term.length > 0) {
      query = query.or(`order_number.ilike.%${term}%,customer_name.ilike.%${term}%,customer_email.ilike.%${term}%`);
    }
  }

  const { data, count } = await query;

  return {
    orders: (data ?? []) as OrderListRow[],
    total: count ?? 0,
    page,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)),
  };
}

export interface OrderDetailItem {
  id: string;
  product_name: string;
  product_slug: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

export interface OrderStatusHistoryEntry {
  id: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor_type: string;
  created_at: string;
}

export interface OrderDetail {
  id: string;
  order_number: string;
  status: OrderStatus;
  payment_status: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  shipping_address: {
    zip: string;
    street: string;
    number: string;
    complement?: string;
    neighborhood: string;
    city: string;
    state: string;
  };
  subtotal: number;
  discount_total: number;
  shipping_total: number;
  total: number;
  shipping_method: string | null;
  shipping_provider: string | null;
  shipping_estimated_days: number | null;
  internal_note: string | null;
  created_at: string;
  updated_at: string;
  items: OrderDetailItem[];
  history: OrderStatusHistoryEntry[];
}

/** `id` é escopado por (tenant_id, id) desde a busca inicial — nunca lido por id sozinho antes de confirmar o tenant (mesmo princípio de get_order_confirmation, Etapa 10). */
export async function getOrderDetail(tenantId: string, orderId: string): Promise<OrderDetail | null> {
  const supabase = await createSupabaseServerClient();

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, order_number, status, payment_status, customer_name, customer_email, customer_phone, shipping_address, subtotal, discount_total, shipping_total, total, shipping_method, shipping_provider, shipping_estimated_days, internal_note, created_at, updated_at",
    )
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!order) return null;

  const [{ data: items }, { data: history }] = await Promise.all([
    supabase
      .from("order_items")
      .select("id, product_name, product_slug, quantity, unit_price, subtotal")
      .eq("order_id", orderId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true }),
    supabase
      .from("audit_logs")
      .select("id, action, before, after, actor_type, created_at")
      .eq("tenant_id", tenantId)
      .eq("resource_type", "order")
      .eq("resource_id", orderId)
      .in("action", ["ORDER_CREATED", "ORDER_STATUS_CHANGED"])
      .order("created_at", { ascending: true }),
  ]);

  return {
    ...(order as unknown as Omit<OrderDetail, "items" | "history">),
    items: (items ?? []) as OrderDetailItem[],
    history: (history ?? []) as OrderStatusHistoryEntry[],
  };
}
