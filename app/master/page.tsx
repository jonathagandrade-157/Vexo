import type { Metadata } from "next";

import { getMasterDashboardStats } from "@/features/master/dashboard-data";

export const metadata: Metadata = { title: "Dashboard MASTER — VEXO" };

function StatCard({ icon, label, value }: { icon: string; label: string; value: number | string }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-surface-container-highest bg-[#121212] p-5">
      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-tertiary-container/20 text-tertiary">
        <span className="material-symbols-outlined text-[22px]">{icon}</span>
      </div>
      <div>
        <p className="font-headline text-headline-sm text-on-surface">{value}</p>
        <p className="font-body text-body-sm text-on-surface-variant">{label}</p>
      </div>
    </div>
  );
}

/** Dashboard inicial do MASTER (prompt §16) — só dados reais, nenhum MRR inventado (cobrança não existe ainda nesta etapa). */
export default async function MasterDashboardPage() {
  const stats = await getMasterDashboardStats();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-headline text-headline-md text-on-surface">Dashboard</h1>
        <p className="mt-1 font-body text-body-md text-on-surface-variant">Visão geral da plataforma VEXO.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard icon="storefront" label="Lojas totais" value={stats.totalTenants} />
        <StatCard icon="check_circle" label="Lojas ativas" value={stats.activeTenants} />
        <StatCard icon="block" label="Lojas suspensas" value={stats.suspendedTenants} />
        <StatCard icon="hourglass_top" label="Trials ativos" value={stats.activeTrials} />
        <StatCard icon="workspace_premium" label="Planos cadastrados" value={stats.totalPlans} />
        <StatCard icon="receipt_long" label="Assinaturas atribuídas" value={stats.totalSubscriptions} />
      </div>

      <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-5">
        <p className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Receita recorrente</p>
        <p className="mt-1 font-body text-body-md text-on-surface-variant">Em breve — cobrança ainda não implementada.</p>
      </div>
    </div>
  );
}
