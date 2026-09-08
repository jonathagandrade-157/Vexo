import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HistoryLogRow } from "@/components/painel/history-log-row";
import { listHistoryForTenant } from "@/features/history/data";
import { HISTORY_ACTIONS, HISTORY_ENTITY_TYPES, HISTORY_PERIOD_FILTERS, historyFiltersSchema, type HistoryPeriodFilter } from "@/features/history/schema";
import { resolveHistoryActionLabel, resolveHistoryEntityLabel } from "@/features/history/messages";
import { getCurrentMembership } from "@/features/painel/current-tenant";
import { listTeamMembers } from "@/features/team/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Histórico — VEXO" };

const PERIOD_LABELS: Record<HistoryPeriodFilter, string> = { today: "Hoje", "7d": "Últimos 7 dias", "30d": "Últimos 30 dias" };

interface PageProps {
  searchParams: Promise<{ action?: string; resourceType?: string; period?: string; userId?: string; page?: string }>;
}

interface HrefParams {
  action?: string;
  resourceType?: string;
  period?: string;
  userId?: string;
  page?: number;
}

function buildHref(params: HrefParams): string {
  const search = new URLSearchParams();
  if (params.action) search.set("action", params.action);
  if (params.resourceType) search.set("resourceType", params.resourceType);
  if (params.period) search.set("period", params.period);
  if (params.userId) search.set("userId", params.userId);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  const qs = search.toString();
  return qs ? `/painel/historico?${qs}` : "/painel/historico";
}

/**
 * D18.4 — `/painel/historico`. Visibilidade gated por `settings.view`
 * (decisão do produto, Fase 2 item 3 — não cria `history.view` nesta
 * entrega; OWNER/ADMIN têm acesso, MANAGER/OPERATOR/SUPPORT não, RBAC real
 * inalterado). Mesmo padrão de `app/painel/equipe/page.tsx`: checagem via
 * RPC `has_permission` aqui decide só o que RENDERIZAR — a autoridade real
 * é `resolveTenantWithSettingsView()` dentro de `listHistoryForTenant`
 * (`features/history/data.ts`), chamada de novo internamente (defesa em
 * profundidade, nunca confia só nesta checagem de UI).
 */
export default async function HistoricoPage({ searchParams }: PageProps) {
  const supabase = await createSupabaseServerClient();

  const membership = await getCurrentMembership();
  if (!membership) redirect("/sem-loja");
  const { tenant } = membership;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: canView } = await supabase.rpc("has_permission", { p_tenant_id: tenant.id, p_permission_key: "settings.view" });

  if (!canView) {
    return (
      <div className="mx-auto flex max-w-[1024px] flex-col gap-8">
        <h1 className="font-headline text-headline-md text-on-surface">Histórico</h1>
        <p className="font-body text-body-sm text-on-surface-variant">Sua função não tem acesso a esta página.</p>
      </div>
    );
  }

  const rawParams = await searchParams;
  const parsedFilters = historyFiltersSchema.safeParse(rawParams);
  const filters = parsedFilters.success ? parsedFilters.data : {};

  const [{ logs, total, page, pageCount }, teamMembers] = await Promise.all([
    listHistoryForTenant(filters),
    listTeamMembers(tenant.id, user.id),
  ]);

  const hasFilters = Boolean(filters.action || filters.resourceType || filters.period || filters.userId);

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-8">
      <div>
        <h1 className="font-headline text-headline-md text-on-surface">Histórico</h1>
        <p className="mt-2 font-body text-body-sm text-on-surface-variant">
          Veja as principais alterações e atividades realizadas na sua loja.
        </p>
      </div>

      <form className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end" method="GET">
        <div className="sm:w-52">
          <label className="mb-1.5 block font-label text-label-md uppercase text-on-surface-variant" htmlFor="period">
            Período
          </label>
          <select
            className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
            defaultValue={filters.period ?? ""}
            id="period"
            name="period"
          >
            <option value="">Qualquer período</option>
            {HISTORY_PERIOD_FILTERS.map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:w-56">
          <label className="mb-1.5 block font-label text-label-md uppercase text-on-surface-variant" htmlFor="userId">
            Usuário
          </label>
          <select
            className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
            defaultValue={filters.userId ?? ""}
            id="userId"
            name="userId"
          >
            <option value="">Todos os usuários</option>
            {teamMembers.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.fullName ?? m.email ?? "Sem nome"}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:w-64">
          <label className="mb-1.5 block font-label text-label-md uppercase text-on-surface-variant" htmlFor="action">
            Evento
          </label>
          <select
            className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
            defaultValue={filters.action ?? ""}
            id="action"
            name="action"
          >
            <option value="">Todos os eventos</option>
            {HISTORY_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {resolveHistoryActionLabel(a)}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:w-52">
          <label className="mb-1.5 block font-label text-label-md uppercase text-on-surface-variant" htmlFor="resourceType">
            Entidade
          </label>
          <select
            className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
            defaultValue={filters.resourceType ?? ""}
            id="resourceType"
            name="resourceType"
          >
            <option value="">Todas as entidades</option>
            {HISTORY_ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {resolveHistoryEntityLabel(t)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-3">
          <button
            className="rounded-lg bg-tertiary-container px-5 py-2.5 font-label text-label-md text-on-tertiary-container transition-opacity hover:opacity-90"
            type="submit"
          >
            Filtrar
          </button>
          {hasFilters ? (
            <Link
              className="rounded-lg border border-outline-variant/50 px-5 py-2.5 text-center font-label text-label-md text-on-surface-variant transition-colors hover:border-tertiary/50"
              href="/painel/historico"
            >
              Limpar
            </Link>
          ) : null}
        </div>
      </form>

      {logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-outline-variant/20 bg-surface-container-low px-6 py-20 text-center">
          <span className="material-symbols-outlined text-3xl text-on-surface-variant opacity-60">history</span>
          <p className="font-body text-body-md text-on-surface-variant">
            {hasFilters ? "Nenhuma atividade encontrada para os filtros selecionados." : "Não há atividades para exibir."}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-low">
            <div className="hidden grid-cols-12 gap-4 border-b border-outline-variant/20 bg-surface-container-lowest px-6 py-4 sm:grid">
              <div className="col-span-2 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Data</div>
              <div className="col-span-2 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Usuário</div>
              <div className="col-span-3 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Ação</div>
              <div className="col-span-2 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Entidade</div>
              <div className="col-span-3 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Descrição</div>
            </div>
            <ul>
              {logs.map((log) => (
                <HistoryLogRow key={log.id} log={log} />
              ))}
            </ul>
          </div>

          <p className="font-body text-body-sm text-on-surface-variant">
            {total} atividade{total === 1 ? "" : "s"} encontrada{total === 1 ? "" : "s"}.
          </p>

          {pageCount > 1 ? (
            <div className="flex items-center justify-between">
              <Link
                aria-disabled={page <= 1}
                className={`rounded-lg border border-outline-variant/50 px-4 py-2 font-label text-label-sm text-on-surface-variant transition-colors ${
                  page <= 1 ? "pointer-events-none opacity-40" : "hover:border-tertiary/50"
                }`}
                href={buildHref({ ...filters, page: page - 1 })}
              >
                ← Anterior
              </Link>
              <span className="font-body text-body-sm text-on-surface-variant">
                Página {page} de {pageCount}
              </span>
              <Link
                aria-disabled={page >= pageCount}
                className={`rounded-lg border border-outline-variant/50 px-4 py-2 font-label text-label-sm text-on-surface-variant transition-colors ${
                  page >= pageCount ? "pointer-events-none opacity-40" : "hover:border-tertiary/50"
                }`}
                href={buildHref({ ...filters, page: page + 1 })}
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
