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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan) => (
          <PlanRow key={plan.id} plan={plan} />
        ))}
      </div>
    </div>
  );
}
