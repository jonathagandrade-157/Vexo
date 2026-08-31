import type { Metadata } from "next";
import Link from "next/link";

import { TenantRow } from "@/components/master/tenant-row";
import { getCurrentPlatformAdmin } from "@/features/master/current-admin";
import { listTenantsForMaster, TENANT_STATUS_FILTERS, type TenantStatusFilter } from "@/features/master/tenants-data";

export const metadata: Metadata = { title: "Lojas — VEXO Master" };

const FILTER_LABELS: Record<"all" | TenantStatusFilter, string> = {
  all: "Todas",
  pending: "Pendentes",
  active: "Ativas",
  suspended: "Suspensas",
};

interface PageProps {
  searchParams: Promise<{ status?: string | string[]; q?: string | string[]; page?: string | string[] }>;
}

interface HrefParams {
  status?: string;
  q?: string;
  page?: number;
}

function buildHref(params: HrefParams): string {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.q) search.set("q", params.q);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  const qs = search.toString();
  return qs ? `/master/lojas?${qs}` : "/master/lojas";
}

/** Colapsa um parâmetro duplicado na URL (`?status=a&status=b`) no primeiro valor — mesma tolerância defensiva de entrada externa já aplicada a `status`/`q`/`page` abaixo (D11.4 §13). */
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isValidFilter(value: string | undefined): value is TenantStatusFilter {
  return Boolean(value) && (TENANT_STATUS_FILTERS as readonly string[]).includes(value as string);
}

/**
 * Etapa 18 — substitui o `ComingSoon` de `/master/lojas` (Etapa 14) pela
 * gestão real de lojas. `canManage` (mudar status) é exclusivo de MASTER;
 * SUPPORT_AGENT enxerga a mesma listagem (mesmo nível de leitura que o
 * resto do `/master`, arquitetura §15), só sem os botões de ação —
 * `updateTenantStatusAction`/`update_tenant_status` também rejeitariam,
 * mas a UI já não oferece o botão para não sugerir uma ação que falharia.
 *
 * D11.4 — busca (nome/slug/e-mail do proprietário) e paginação real no
 * banco, ambas expressas na URL (`status`/`q`/`page`) junto do filtro de
 * status já existente. Trocar o status preserva `q` (e reseta `page`,
 * porque nenhum link de status carrega `page`); pesquisar preserva
 * `status` via campo oculto no formulário (e também reseta `page`, pelo
 * mesmo motivo: o formulário não tem campo `page`); paginar preserva os
 * dois. Nenhuma regra de negócio de lojas (ativar/suspender/trocar plano)
 * foi tocada.
 */
export default async function MasterLojasPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const statusParam = firstParam(raw.status);
  const q = firstParam(raw.q)?.slice(0, 100);
  const pageParam = firstParam(raw.page);

  const filter = isValidFilter(statusParam) ? statusParam : undefined;
  const pageNumber = pageParam ? Number(pageParam) : 1;
  const page = Number.isFinite(pageNumber) && pageNumber > 0 ? Math.floor(pageNumber) : 1;

  const [admin, result] = await Promise.all([
    getCurrentPlatformAdmin(),
    listTenantsForMaster({ status: filter, q, page }),
  ]);
  const { tenants, total, pageCount } = result;
  const canManage = admin?.role === "MASTER";
  const hasFilters = Boolean(filter || q);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-headline text-headline-md text-on-surface">Lojas</h1>
        <p className="mt-1 font-body text-body-md text-on-surface-variant">
          {total} loja(s) {filter ? FILTER_LABELS[filter].toLowerCase() : "no total"}
          {q ? ` correspondendo a "${q}"` : ""}.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["all", ...TENANT_STATUS_FILTERS] as const).map((key) => {
          const href = buildHref({ status: key === "all" ? undefined : key, q });
          const active = key === "all" ? !filter : filter === key;
          return (
            <Link
              className={
                active
                  ? "rounded-full bg-tertiary-container px-4 py-1.5 font-label text-label-sm text-on-tertiary-container"
                  : "rounded-full border border-outline-variant/50 px-4 py-1.5 font-label text-label-sm text-on-surface-variant transition-colors hover:border-tertiary/50"
              }
              href={href}
              key={key}
            >
              {FILTER_LABELS[key]}
            </Link>
          );
        })}
      </div>

      <form className="flex flex-col gap-3 sm:flex-row sm:items-end" method="GET">
        {filter ? <input name="status" type="hidden" value={filter} /> : null}
        <div className="flex-1">
          <label className="mb-1.5 block font-label text-label-md uppercase text-on-surface-variant" htmlFor="q">
            Buscar
          </label>
          <input
            className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
            defaultValue={q ?? ""}
            id="q"
            name="q"
            placeholder="Buscar loja, slug ou e-mail…"
            type="text"
          />
        </div>
        <div className="flex gap-3">
          <button
            className="rounded-lg bg-tertiary-container px-5 py-2.5 font-label text-label-md text-on-tertiary-container transition-opacity hover:opacity-90"
            type="submit"
          >
            Buscar
          </button>
          {hasFilters ? (
            <Link
              className="rounded-lg border border-outline-variant/50 px-5 py-2.5 text-center font-label text-label-md text-on-surface-variant transition-colors hover:border-tertiary/50"
              href="/master/lojas"
            >
              Limpar
            </Link>
          ) : null}
        </div>
      </form>

      {tenants.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-surface-container-highest bg-[#121212] px-6 py-20 text-center">
          <span className="material-symbols-outlined text-3xl text-on-surface-variant opacity-60">storefront</span>
          <p className="font-body text-body-md text-on-surface-variant">
            {hasFilters ? "Nenhuma loja corresponde aos filtros atuais." : "Nenhuma loja cadastrada."}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-surface-container-highest bg-[#121212]">
            <div className="hidden grid-cols-12 gap-4 border-b border-surface-container-highest bg-surface-container-low/50 px-6 py-4 sm:grid">
              <div className="col-span-3 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Loja</div>
              <div className="col-span-3 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Proprietário</div>
              <div className="col-span-2 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Plano / Trial</div>
              <div className="col-span-1 text-center font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Status</div>
              <div className="col-span-3 text-right font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Ações</div>
            </div>
            <div className="divide-y divide-surface-container-highest/50">
              {tenants.map((tenant) => (
                <TenantRow canManage={canManage} key={tenant.id} tenant={tenant} />
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
                href={buildHref({ status: filter, q, page: page - 1 })}
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
                href={buildHref({ status: filter, q, page: page + 1 })}
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
