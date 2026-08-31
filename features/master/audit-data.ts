import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export const AUDIT_PAGE_SIZE = 20;

/**
 * D11.2 — valores reais de `audit_logs.action`, levantados diretamente dos
 * pontos de chamada de `private.log_audit()` nas migrations (nenhum valor
 * inventado — ver relatório final para o método de verificação). Só serve
 * para popular o filtro de evento; a listagem em si sempre mostra
 * `action` como veio do banco, então uma ação nova de uma migration futura
 * aparece normalmente na listagem mesmo antes de ser adicionada aqui — só
 * não aparece como opção no filtro até essa linha ser adicionada.
 *
 * `PAYMENT_OVERRIDE` existe apenas como `check` constraint em
 * `audit_logs` (reservado para um futuro override manual de pagamento) —
 * nenhum trigger/RPC o emite hoje, por isso fica fora desta lista.
 */
export const AUDIT_ACTIONS = [
  "BILLING_INVOICE_CREATED",
  "BILLING_PAYMENT_CONFIRMED",
  "BILLING_PAYMENT_FAILED",
  "BILLING_SUBSCRIPTION_CANCELLED",
  "BILLING_SUBSCRIPTION_SUSPENDED",
  "CATEGORY_CREATED",
  "CATEGORY_DELETED",
  "CATEGORY_UPDATED",
  "FEATURE_CREATED",
  "FEATURE_UPDATED",
  "ORDER_CREATED",
  "ORDER_PAYMENT_CONFIRMED",
  "ORDER_STATUS_CHANGED",
  "PAYMENT_APPROVED",
  "PAYMENT_CANCELLED",
  "PAYMENT_CONNECTION_CREATED",
  "PAYMENT_CONNECTION_REMOVED",
  "PAYMENT_CREATED",
  "PAYMENT_REFUNDED",
  "PAYMENT_REJECTED",
  "PAYMENT_UPDATED",
  "PLAN_ACTIVATED",
  "PLAN_CREATED",
  "PLAN_DEACTIVATED",
  "PLAN_FEATURE_DISABLED",
  "PLAN_FEATURE_ENABLED",
  "PLAN_LIMIT_REMOVED",
  "PLAN_LIMIT_SET",
  "PLAN_LIMIT_UPDATED",
  "PLAN_UPDATED",
  "PRODUCT_CREATED",
  "PRODUCT_DELETED",
  "PRODUCT_IMAGE_DELETED",
  "PRODUCT_IMAGE_UPDATED",
  "PRODUCT_IMAGE_UPLOADED",
  "PRODUCT_STATUS_CHANGED",
  "PRODUCT_UPDATED",
  "SHIPPING_METHOD_CREATED",
  "SHIPPING_METHOD_DELETED",
  "SHIPPING_METHOD_UPDATED",
  "SHIPPING_PROVIDER_CONNECTION_CREATED",
  "SHIPPING_PROVIDER_CONNECTION_REMOVED",
  "SHIPPING_SETTINGS_UPDATED",
  "TENANT_CREATED",
  "TENANT_ONBOARDING_COMPLETED",
  "TENANT_PLAN_CHANGED",
  "TENANT_SETTINGS_UPDATED",
  "TENANT_STATUS_CHANGED",
  "TENANT_SUSPENDED",
  "TRIAL_STARTED",
  "USER_CREATED",
  "USER_ROLE_CHANGED",
] as const;

export const AUDIT_PERIOD_FILTERS = ["today", "7d", "30d"] as const;
export type AuditPeriodFilter = (typeof AUDIT_PERIOD_FILTERS)[number];
const PERIOD_TO_DAYS: Record<AuditPeriodFilter, number> = { today: 0, "7d": 7, "30d": 30 };

export interface ListAuditLogsOptions {
  action?: string;
  period?: AuditPeriodFilter;
  q?: string;
  page?: number;
}

export interface AuditLogRow {
  id: string;
  createdAt: string;
  action: string;
  actorType: string;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  tenantId: string | null;
  tenantName: string | null;
  resourceType: string | null;
  resourceId: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
}

export interface AuditLogListResult {
  logs: AuditLogRow[];
  total: number;
  page: number;
  pageCount: number;
}

interface RawAuditLogRow {
  id: string;
  created_at: string;
  action: string;
  actor_type: string;
  actor_user_id: string | null;
  tenant_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
  tenants: { name: string; slug: string } | { name: string; slug: string }[] | null;
}

function first<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Mesmo raciocínio de sanitização de `features/orders/data.ts::sanitizeSearchTerm`
 * (não compartilhado entre features de propósito, mesmo padrão de `first<T>`
 * duplicado localmente em `features/master/tenants-data.ts`) — escapa `,`/`(`/`)`
 * (sintaxe de filtro do `.or()` do PostgREST) e os curingas de `LIKE`
 * (`%`/`_`), nunca interpretados como sintaxe.
 */
function sanitizeSearchTerm(raw: string): string {
  return raw
    .replace(/[,()]/g, " ")
    .replace(/[%_\\]/g, (c) => `\\${c}`)
    .trim()
    .slice(0, 100);
}

const REDACTED = "[redacted]";

/**
 * D11.2 §13 — defesa em profundidade sobre `before`/`after`/`metadata`.
 * Nenhum trigger existente hoje grava token/secret/senha nesses campos
 * (`PAYMENT_CONNECTION_CREATED`/`SHIPPING_PROVIDER_CONNECTION_CREATED` já
 * mascaram `connected_account_id` via `private.mask_account_id()` antes de
 * chegar aqui, e nenhuma credencial jamais passa por `audit_logs` — vive
 * só em `payment_credentials_vault`/`shipping_credentials_vault`,
 * inacessível fora de `service_role`). Mesmo assim, esta função redige
 * recursivamente qualquer chave cujo nome sugira um segredo, como rede de
 * segurança contra um futuro `log_audit()` que grave algo sensível por
 * engano — nunca confia em "sabemos que não tem nada sensível hoje".
 */
const SENSITIVE_KEY_PATTERN = /token|secret|password|senha|credential|api[_-]?key|client[_-]?secret|webhook[_-]?secret/i;

function redactSensitiveJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, v]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactSensitiveJson(v),
      ]),
    );
  }
  return value;
}

/**
 * Listagem paginada de `audit_logs` para `/master/auditoria` — sem filtro
 * de `tenant_id` (MASTER/SUPPORT_AGENT enxergam a plataforma inteira,
 * igual à policy de RLS já existente: `is_platform_admin()` sozinho já
 * libera a leitura de qualquer linha, `tenant_id` só entra na policy para
 * o caso de um membro comum de tenant, que nunca chega a esta função).
 *
 * `tenants(name, slug)` é um embed seguro (única FK de `audit_logs` para
 * `tenants`, sem a ambiguidade de `subscriptions`→`plans` corrigida no
 * D3.2-B Ponto 2F.4) — nunca lança PGRST201.
 *
 * Busca textual restrita a `resource_id`/`reason`/`action` — as três
 * únicas colunas de texto plano relevantes; nunca em `before`/`after`/
 * `metadata` (JSON, potencialmente grande, sem índice — ver pendência de
 * performance no relatório final).
 *
 * `count: "exact"` mesmo padrão já usado em `features/orders/data.ts::listOrders`
 * — aceitável para uma tela interna de baixo tráfego; ver pendência de
 * performance no relatório final para o que fazer se `audit_logs` crescer
 * muito.
 */
export async function listAuditLogsForMaster(opts: ListAuditLogsOptions): Promise<AuditLogListResult> {
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const from = (page - 1) * AUDIT_PAGE_SIZE;
  const to = from + AUDIT_PAGE_SIZE - 1;

  let query = supabase
    .from("audit_logs")
    .select(
      "id, created_at, action, actor_type, actor_user_id, tenant_id, resource_type, resource_id, reason, before, after, metadata, tenants(name, slug)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (opts.action && (AUDIT_ACTIONS as readonly string[]).includes(opts.action)) {
    query = query.eq("action", opts.action);
  }

  if (opts.period) {
    const days = PERIOD_TO_DAYS[opts.period];
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - days);
    query = query.gte("created_at", since.toISOString());
  }

  const search = opts.q?.trim();
  if (search) {
    const term = sanitizeSearchTerm(search);
    if (term.length > 0) {
      query = query.or(`resource_id.ilike.%${term}%,reason.ilike.%${term}%,action.ilike.%${term}%`);
    }
  }

  const { data, count, error } = await query;

  if (error) {
    console.error("[listAuditLogsForMaster] failed to load audit logs", { error: error.message });
    throw new Error("Não foi possível carregar os registros de auditoria.");
  }

  const rows = (data ?? []) as unknown as RawAuditLogRow[];

  const actorIds = [...new Set(rows.map((r) => r.actor_user_id).filter((id): id is string => Boolean(id)))];
  const { data: profileRows } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", actorIds)
    : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
  const profileById = new Map((profileRows ?? []).map((p) => [p.id, p]));

  const logs: AuditLogRow[] = rows.map((r) => {
    const tenant = first(r.tenants);
    const actor = r.actor_user_id ? profileById.get(r.actor_user_id) : undefined;
    return {
      id: r.id,
      createdAt: r.created_at,
      action: r.action,
      actorType: r.actor_type,
      actorUserId: r.actor_user_id,
      actorName: actor?.full_name ?? null,
      actorEmail: actor?.email ?? null,
      tenantId: r.tenant_id,
      tenantName: tenant?.name ?? null,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      reason: r.reason,
      before: redactSensitiveJson(r.before),
      after: redactSensitiveJson(r.after),
      metadata: redactSensitiveJson(r.metadata),
    };
  });

  return {
    logs,
    total: count ?? 0,
    page,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / AUDIT_PAGE_SIZE)),
  };
}
