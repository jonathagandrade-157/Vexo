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
  searchParams: Promise<{ status?: string }>;
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
 */
export default async function MasterLojasPage({ searchParams }: PageProps) {
  const { status } = await searchParams;
  const filter = isValidFilter(status) ? status : undefined;

  const [admin, tenants] = await Promise.all([getCurrentPlatformAdmin(), listTenantsForMaster(filter)]);
  const canManage = admin?.role === "MASTER";

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-headline text-headline-md text-on-surface">Lojas</h1>
        <p className="mt-1 font-body text-body-md text-on-surface-variant">
          {tenants.length} loja(s) {filter ? FILTER_LABELS[filter].toLowerCase() : "no total"}.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["all", ...TENANT_STATUS_FILTERS] as const).map((key) => {
          const href = key === "all" ? "/master/lojas" : `/master/lojas?status=${key}`;
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

      {tenants.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-surface-container-highest bg-[#121212] px-6 py-20 text-center">
          <span className="material-symbols-outlined text-3xl text-on-surface-variant opacity-60">storefront</span>
          <p className="font-body text-body-md text-on-surface-variant">Nenhuma loja encontrada para este filtro.</p>
        </div>
      ) : (
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
      )}
    </div>
  );
}
