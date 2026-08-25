"use client";

import Link from "next/link";
import { useTransition } from "react";

import { PlanFormDialog } from "@/components/master/plan-form-dialog";
import { togglePlanActiveAction } from "@/features/commercial/actions";
import { formatPrice } from "@/features/products/format-price";
import type { PlanRowWithCounts } from "@/features/commercial/data";

function StatBlock({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-lg bg-surface-container-lowest px-3 py-2">
      <span className="font-headline text-headline-sm text-on-surface">{value}</span>
      <span className="text-center font-label text-label-sm uppercase tracking-wider text-on-surface-variant">{label}</span>
    </div>
  );
}

/** Card de plano do `/master/planos` (Etapa 20 §1/§6) — todo número exibido vem de `listPlans()` (agregado real de `subscriptions`/`tenants`), nunca mockado; "0 lojas" é um valor real, não um placeholder. */
export function PlanRow({ plan }: { plan: PlanRowWithCounts }) {
  const [isToggling, startToggle] = useTransition();
  const { storeCounts } = plan;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-surface-container-highest bg-[#121212] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-headline text-headline-sm text-on-surface">
            {plan.name}
            {plan.is_featured ? (
              <span className="material-symbols-outlined text-[18px] text-tertiary" title="Destaque comercial">
                star
              </span>
            ) : null}
          </div>
          <div className="font-label text-label-sm text-on-surface-variant">{plan.slug}</div>
        </div>
        <span
          className={
            plan.is_active
              ? "rounded-full bg-emerald-500/10 px-2.5 py-1 font-label text-label-sm uppercase text-emerald-400"
              : "rounded-full bg-surface-container-highest px-2.5 py-1 font-label text-label-sm uppercase text-on-surface-variant"
          }
        >
          {plan.is_active ? "Ativo" : "Inativo"}
        </span>
      </div>

      {plan.description ? <p className="font-body text-body-sm text-on-surface-variant">{plan.description}</p> : null}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 font-body text-body-md text-on-surface">
        <span>{plan.monthly_price !== null ? `${formatPrice(plan.monthly_price)}/mês` : "Mensal: a definir"}</span>
        <span>{plan.yearly_price !== null ? `${formatPrice(plan.yearly_price)}/ano` : "Anual: a definir"}</span>
        <span className="text-on-surface-variant">{plan.trial_days} dias de trial</span>
        <span className="text-on-surface-variant">
          {plan.feature_count} recurso{plan.feature_count === 1 ? "" : "s"}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <StatBlock label="Lojas" value={storeCounts.total} />
        <StatBlock label="Em trial" value={storeCounts.trialing} />
        <StatBlock label="Ativas" value={storeCounts.active} />
        <StatBlock label="Suspensas" value={storeCounts.suspended} />
      </div>

      <div className="flex items-center justify-end gap-1 border-t border-surface-container-highest pt-3">
        <Link
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-label text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-tertiary"
          href={`/master/planos/${plan.id}`}
        >
          <span className="material-symbols-outlined text-[18px]">tune</span>
          Recursos e limites
        </Link>
        <PlanFormDialog
          plan={plan}
          trigger={
            <span className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-label text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-tertiary">
              <span className="material-symbols-outlined text-[18px]">edit</span>
              Editar
            </span>
          }
        />
        <button
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-label text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-tertiary disabled:opacity-50"
          disabled={isToggling}
          onClick={() =>
            startToggle(async () => {
              await togglePlanActiveAction(plan.id, !plan.is_active);
            })
          }
          type="button"
        >
          <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
          {plan.is_active ? "Desativar" : "Ativar"}
        </button>
      </div>
    </div>
  );
}
