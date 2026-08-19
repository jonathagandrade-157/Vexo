import type { Metadata } from "next";

import { PlanFormDialog } from "@/components/master/plan-form-dialog";
import { PlanRow } from "@/components/master/plan-row";
import { listPlans } from "@/features/commercial/data";

export const metadata: Metadata = { title: "Planos — VEXO Master" };

/** `/master/planos` (prompt Etapa 14 §17) — lista real, criar/editar/ativar-desativar/ver recursos. */
export default async function MasterPlanosPage() {
  const plans = await listPlans();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="font-headline text-headline-md text-on-surface">Planos</h1>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">
            Planos comerciais da VEXO — preços podem ficar em aberto até serem definidos.
          </p>
        </div>
        <PlanFormDialog
          trigger={
            <span className="flex items-center justify-center gap-2 rounded-lg bg-tertiary-container px-5 py-2.5 font-label text-label-md text-on-tertiary-container transition-opacity hover:opacity-90">
              <span className="material-symbols-outlined text-[20px]">add</span>
              Novo plano
            </span>
          }
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-surface-container-highest bg-[#121212]">
        <div className="grid grid-cols-12 gap-4 border-b border-surface-container-highest bg-surface-container-low/50 px-6 py-4">
          <div className="col-span-3 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Plano</div>
          <div className="col-span-2 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Mensal</div>
          <div className="col-span-2 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Anual</div>
          <div className="col-span-2 text-center font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Recursos</div>
          <div className="col-span-1 text-center font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Status</div>
          <div className="col-span-2 text-right font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Ações</div>
        </div>
        <div className="divide-y divide-surface-container-highest/50">
          {plans.map((plan) => (
            <PlanRow key={plan.id} plan={plan} />
          ))}
        </div>
      </div>
    </div>
  );
}
