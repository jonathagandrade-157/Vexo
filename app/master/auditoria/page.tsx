import type { Metadata } from "next";
import Link from "next/link";

import { AuditLogRow } from "@/components/master/audit-log-row";
import { AUDIT_ACTIONS, AUDIT_PERIOD_FILTERS, listAuditLogsForMaster, type AuditPeriodFilter } from "@/features/master/audit-data";

export const metadata: Metadata = { title: "Auditoria — VEXO Master" };

const PERIOD_LABELS: Record<AuditPeriodFilter, string> = { today: "Hoje", "7d": "Últimos 7 dias", "30d": "Últimos 30 dias" };

interface PageProps {
  searchParams: Promise<{ q?: string; action?: string; period?: string; page?: string }>;
}

interface HrefParams {
  q?: string;
  action?: string;
  period?: string;
  page?: number;
}

function buildHref(params: HrefParams): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.action) search.set("action", params.action);
  if (params.period) search.set("period", params.period);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  const qs = search.toString();
  return qs ? `/master/auditoria?${qs}` : "/master/auditoria";
}

function isValidPeriod(value: string | undefined): value is AuditPeriodFilter {
  return Boolean(value) && (AUDIT_PERIOD_FILTERS as readonly string[]).includes(value as string);
}

/**
 * D11.2 — `/master/auditoria`, consumindo somente a infraestrutura de
 * auditoria já existente desde a Etapa 2 (`audit_logs` + `private.log_audit()`
 * + triggers automáticos): esta página nunca escreve em `audit_logs`, só lê
 * através de `listAuditLogsForMaster` (RLS: `is_platform_admin()`, mesma
 * policy de sempre — MASTER e SUPPORT_AGENT leem igualmente, nenhum dos
 * dois pode alterar nada por aqui).
 */
export default async function MasterAuditoriaPage({ searchParams }: PageProps) {
  const { q, action: actionParam, period: periodParam, page: pageParam } = await searchParams;

  const validAction = actionParam && (AUDIT_ACTIONS as readonly string[]).includes(actionParam) ? actionParam : undefined;
  const validPeriod = isValidPeriod(periodParam) ? periodParam : undefined;
  const page = pageParam ? Number(pageParam) : 1;

  const { logs, total, pageCount } = await listAuditLogsForMaster({
    q,
    action: validAction,
    period: validPeriod,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  });

  const hasFilters = Boolean(q || validAction || validPeriod);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-headline text-headline-md text-on-surface">Auditoria</h1>
        <p className="mt-1 font-body text-body-md text-on-surface-variant">
          {total === 0 ? "Nenhum registro de auditoria encontrado." : `${total} registro(s) de auditoria encontrado(s).`}
        </p>
      </div>

      <form className="flex flex-col gap-3" method="GET">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1.5 block font-label text-label-md uppercase text-on-surface-variant" htmlFor="q">
              Buscar
            </label>
            <input
              className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
              defaultValue={q ?? ""}
              id="q"
              name="q"
              placeholder="Identificador, motivo ou tipo de evento"
              type="text"
            />
          </div>
          <div className="sm:w-64">
            <label className="mb-1.5 block font-label text-label-md uppercase text-on-surface-variant" htmlFor="action">
              Evento
            </label>
            <select
              className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
              defaultValue={validAction ?? ""}
              id="action"
              name="action"
            >
              <option value="">Todos os eventos</option>
              {AUDIT_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:w-52">
            <label className="mb-1.5 block font-label text-label-md uppercase text-on-surface-variant" htmlFor="period">
              Período
            </label>
            <select
              className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
              defaultValue={validPeriod ?? ""}
              id="period"
              name="period"
            >
              <option value="">Qualquer período</option>
              {AUDIT_PERIOD_FILTERS.map((p) => (
                <option key={p} value={p}>
                  {PERIOD_LABELS[p]}
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
                href="/master/auditoria"
              >
                Limpar
              </Link>
            ) : null}
          </div>
        </div>
      </form>

      {logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-surface-container-highest bg-[#121212] px-6 py-20 text-center">
          <span className="material-symbols-outlined text-3xl text-on-surface-variant opacity-60">history</span>
          <p className="font-body text-body-md text-on-surface-variant">
            {hasFilters ? "Nenhum registro corresponde à busca/filtro atual." : "Nenhum registro de auditoria encontrado."}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-surface-container-highest bg-[#121212]">
            <div className="hidden grid-cols-12 gap-4 border-b border-surface-container-highest bg-surface-container-low/50 px-6 py-4 sm:grid">
              <div className="col-span-2 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Quando</div>
              <div className="col-span-3 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Evento</div>
              <div className="col-span-2 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Ator</div>
              <div className="col-span-2 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Loja / Entidade</div>
              <div className="col-span-3 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Motivo</div>
            </div>
            <div>
              {logs.map((log) => (
                <AuditLogRow key={log.id} log={log} />
              ))}
            </div>
          </div>

          {pageCount > 1 ? (
            <div className="flex items-center justify-between">
              <Link
                aria-disabled={page <= 1}
                className={`rounded-lg border border-outline-variant/50 px-4 py-2 font-label text-label-sm text-on-surface-variant transition-colors ${
                  page <= 1 ? "pointer-events-none opacity-40" : "hover:border-tertiary/50"
                }`}
                href={buildHref({ q, action: validAction, period: validPeriod, page: page - 1 })}
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
                href={buildHref({ q, action: validAction, period: validPeriod, page: page + 1 })}
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
