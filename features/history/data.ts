import "server-only";

import { redactSensitiveJson } from "@/features/master/audit-data";
import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { HISTORY_ACTIONS, HISTORY_ENTITY_TYPES, HISTORY_PAGE_SIZE, HISTORY_PERIOD_FILTERS, type HistoryFilters } from "./schema";

export interface HistoryLogRow {
  id: string;
  createdAt: string;
  action: string;
  actorType: string;
  actorUserId: string | null;
  actorName: string | null;
  resourceType: string | null;
  resourceId: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
}

export interface HistoryListResult {
  logs: HistoryLogRow[];
  total: number;
  page: number;
  pageCount: number;
}

interface RawHistoryRow {
  id: string;
  created_at: string;
  action: string;
  actor_type: string;
  actor_user_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
}

const PERIOD_TO_DAYS: Record<(typeof HISTORY_PERIOD_FILTERS)[number], number> = { today: 0, "7d": 7, "30d": 30 };

/**
 * D18.4 §3 — mesmo padrão de `resolveTenantWithTeamManage`
 * (`features/team/actions.ts`, cópia local de propósito, não compartilhada
 * — mesmo princípio documentado ali): resolve o tenant a partir da SESSÃO
 * (nunca de um `tenantId` vindo do chamador) e confere `settings.view`
 * (decisão do produto D18.4 Fase 2 item 3 — não cria `history.view`
 * nesta entrega). Chamada de dentro de `listHistoryForTenant`, então esta
 * checagem vale mesmo que a página que chama esta função algum dia deixe de
 * checar `settings.view` por conta própria antes de renderizar — defesa em
 * profundidade, não a única camada (a RLS de `audit_logs`, inalterada nesta
 * fase, continua sendo quem realmente decide quais LINHAS existem para
 * `.eq("tenant_id", ...)` enxergar).
 */
async function resolveTenantWithSettingsView(): Promise<{ tenantId: string }> {
  const supabase = await createSupabaseServerClient();
  const membership = await resolveActiveTenantForUser(supabase);
  if (!membership || membership.tenant.onboarding_completed_at === null) {
    throw new Error("Nenhuma loja configurada para esta conta.");
  }

  const { data: allowed } = await supabase.rpc("has_permission", {
    p_tenant_id: membership.tenant.id,
    p_permission_key: "settings.view",
  });
  if (!allowed) {
    throw new Error("Você não tem permissão para ver o histórico desta loja.");
  }

  return { tenantId: membership.tenant.id };
}

/**
 * D18.4 — listagem paginada de `audit_logs` para `/painel/historico`.
 * Mesmo esqueleto de `features/master/audit-data.ts::listAuditLogsForMaster`
 * (client de SESSÃO, `count: "exact"`, `range()` para paginação no banco,
 * `order("created_at", { ascending: false })`) com duas diferenças
 * deliberadas:
 *
 *   1. SEMPRE filtra `.eq("tenant_id", tenantId)` — `tenantId` nunca vem de
 *      `filters` (o tipo `HistoryFilters` nem declara esse campo): é
 *      resolvido aqui dentro, a partir da sessão, via
 *      `resolveTenantWithSettingsView()`. Isso automaticamente exclui todo
 *      evento de escopo de plataforma (`PLAN_*`/`FEATURE_*`/`PLAN_LIMIT_*`,
 *      sempre `tenant_id = null`) sem precisar de nenhum filtro adicional —
 *      `tenant_id = null` nunca é igual a um uuid concreto.
 *   2. Nunca usa `service_role` — o client de sessão + a RLS já existente
 *      de `audit_logs` (policy "tenant members and platform admins can
 *      select audit_logs", migration 20260817220015, intencionalmente NÃO
 *      alterada nesta fase) é a autoridade real sobre quais linhas existem;
 *      `.eq("tenant_id", tenantId)` aqui é só uma segunda camada (defesa em
 *      profundidade), nunca a única.
 *
 * `filters` já chega validado por `historyFiltersSchema` (Zod) — esta
 * função ainda reconfirma cada valor contra o catálogo real
 * (`HISTORY_ACTIONS`/`HISTORY_ENTITY_TYPES`/`HISTORY_PERIOD_FILTERS`) antes
 * de aplicar ao `WHERE`, mesmo princípio de `listAuditLogsForMaster` — um
 * valor que não é um evento/entidade/período real do catálogo é
 * descartado, nunca vira filtro nenhum.
 */
export async function listHistoryForTenant(filters: HistoryFilters): Promise<HistoryListResult> {
  const { tenantId } = await resolveTenantWithSettingsView();
  const supabase = await createSupabaseServerClient();

  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const from = (page - 1) * HISTORY_PAGE_SIZE;
  const to = from + HISTORY_PAGE_SIZE - 1;

  let query = supabase
    .from("audit_logs")
    .select("id, created_at, action, actor_type, actor_user_id, resource_type, resource_id, before, after, metadata", {
      count: "exact",
    })
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (filters.action && (HISTORY_ACTIONS as readonly string[]).includes(filters.action)) {
    query = query.eq("action", filters.action);
  }

  if (filters.resourceType && (HISTORY_ENTITY_TYPES as readonly string[]).includes(filters.resourceType)) {
    query = query.eq("resource_type", filters.resourceType);
  }

  if (filters.userId) {
    query = query.eq("actor_user_id", filters.userId);
  }

  if (filters.period && filters.period in PERIOD_TO_DAYS) {
    const days = PERIOD_TO_DAYS[filters.period];
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - days);
    query = query.gte("created_at", since.toISOString());
  }

  const { data, count, error } = await query;

  if (error) {
    console.error("[listHistoryForTenant] failed to load history", { error: error.message });
    throw new Error("Não foi possível carregar o histórico da loja.");
  }

  const rows = (data ?? []) as unknown as RawHistoryRow[];

  // Fase 2 §6/§10 — nunca tenta resolver `profiles` para `system`/`master`:
  // só os ids de linhas com `actor_type = 'user'` entram nesta busca, mesmo
  // que `actor_user_id` viesse preenchido por acaso em outro tipo.
  const userActorIds = [
    ...new Set(rows.filter((r) => r.actor_type === "user" && r.actor_user_id).map((r) => r.actor_user_id as string)),
  ];
  const { data: profileRows } = userActorIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", userActorIds)
    : { data: [] as { id: string; full_name: string | null }[] };
  const nameById = new Map((profileRows ?? []).map((p) => [p.id, p.full_name]));

  const logs: HistoryLogRow[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    action: r.action,
    actorType: r.actor_type,
    actorUserId: r.actor_user_id,
    actorName: r.actor_type === "user" && r.actor_user_id ? (nameById.get(r.actor_user_id) ?? null) : null,
    resourceType: r.resource_type,
    resourceId: r.resource_id,
    before: redactSensitiveJson(r.before),
    after: redactSensitiveJson(r.after),
    metadata: redactSensitiveJson(r.metadata),
  }));

  return {
    logs,
    total: count ?? 0,
    page,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / HISTORY_PAGE_SIZE)),
  };
}
