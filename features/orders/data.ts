import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  ORDER_STATUSES,
  type OrderSource,
  type OrderStatus,
  type PaymentChannel,
  type RequestedPaymentMethod,
} from "./schema";

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
  order_source: OrderSource;
  payment_channel: PaymentChannel;
  requested_payment_method: RequestedPaymentMethod | null;
  cash_change_for: number | null;
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

/** Fase D2-B.3 — mesmo raciocínio: número/nome/e-mail já buscavam; telefone (auditoria §10: "Busca: ... Telefone") passa a entrar no mesmo `.or()`, mesma sanitização. */
export interface ListOrdersOptions {
  search?: string;
  status?: string;
  origin?: string;
  payment?: string;
  period?: string;
  page?: number;
}

const PERIOD_TO_DAYS: Record<string, number> = { today: 0, "7d": 7, "30d": 30 };

/**
 * Traduz o filtro de "Pagamento" (um único menu, do jeito que o lojista
 * pensa) para os dois eixos reais já existentes no banco — nunca um
 * valor novo é gravado, isto só molda a query de leitura.
 */
function applyPaymentFilter(
  query: ReturnType<typeof buildBaseOrdersQuery>,
  payment: string | undefined,
): ReturnType<typeof buildBaseOrdersQuery> {
  if (payment === "mercadopago") return query.eq("payment_channel", "gateway");
  if (payment === "pix" || payment === "cash" || payment === "card") {
    return query.eq("payment_channel", "external").eq("requested_payment_method", payment);
  }
  return query;
}

function buildBaseOrdersQuery(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, tenantId: string) {
  return supabase
    .from("orders")
    .select(
      "id, order_number, customer_name, customer_email, customer_phone, created_at, total, status, payment_status, shipping_method, order_source, payment_channel, requested_payment_method, cash_change_for",
      { count: "exact" },
    )
    .eq("tenant_id", tenantId);
}

/** Sempre escopada ao tenant do chamador (defesa em profundidade — RLS de `orders.view`, Etapa 10, já escopa por si só). */
export async function listOrders(tenantId: string, opts: ListOrdersOptions): Promise<OrderListResult> {
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = buildBaseOrdersQuery(supabase, tenantId).order("created_at", { ascending: false }).range(from, to);

  // Aceita uma lista separada por vírgula (ex.: "PENDING,PAID") além de um
  // único valor — usado pelas abas da lista (Fase D2-B.3 §11: "Novos"
  // agrupa PENDING+PAID sem criar um status novo no banco). Continua
  // 100% compatível com o filtro de status anterior (um único valor é só
  // uma lista de tamanho 1).
  if (opts.status) {
    const statuses = opts.status.split(",").filter((s) => (ORDER_STATUSES as readonly string[]).includes(s));
    if (statuses.length === 1) query = query.eq("status", statuses[0]);
    else if (statuses.length > 1) query = query.in("status", statuses);
  }

  if (opts.origin === "vexo_checkout" || opts.origin === "whatsapp") {
    query = query.eq("order_source", opts.origin);
  }

  query = applyPaymentFilter(query, opts.payment);

  const periodDays = opts.period ? PERIOD_TO_DAYS[opts.period] : undefined;
  if (periodDays !== undefined) {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - periodDays);
    query = query.gte("created_at", since.toISOString());
  }

  const search = opts.search?.trim();
  if (search) {
    const term = sanitizeSearchTerm(search);
    if (term.length > 0) {
      query = query.or(
        `order_number.ilike.%${term}%,customer_name.ilike.%${term}%,customer_email.ilike.%${term}%,customer_phone.ilike.%${term}%`,
      );
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
  reason: string | null;
  created_at: string;
}

export interface OrderDetail {
  id: string;
  order_number: string;
  status: OrderStatus;
  payment_status: string;
  order_source: OrderSource;
  payment_channel: PaymentChannel;
  requested_payment_method: RequestedPaymentMethod | null;
  cash_change_for: number | null;
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
      "id, order_number, status, payment_status, order_source, payment_channel, requested_payment_method, cash_change_for, customer_name, customer_email, customer_phone, shipping_address, subtotal, discount_total, shipping_total, total, shipping_method, shipping_provider, shipping_estimated_days, internal_note, created_at, updated_at",
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
      .select("id, action, before, after, actor_type, reason, created_at")
      .eq("tenant_id", tenantId)
      .eq("resource_type", "order")
      .eq("resource_id", orderId)
      .in("action", ["ORDER_CREATED", "ORDER_STATUS_CHANGED", "ORDER_PAYMENT_CONFIRMED"])
      .order("created_at", { ascending: true }),
  ]);

  return {
    ...(order as unknown as Omit<OrderDetail, "items" | "history">),
    items: (items ?? []) as OrderDetailItem[],
    history: (history ?? []) as OrderStatusHistoryEntry[],
  };
}
