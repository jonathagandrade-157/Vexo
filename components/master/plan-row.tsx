"use client";

import Link from "next/link";
import { useTransition } from "react";

import { PlanFormDialog } from "@/components/master/plan-form-dialog";
import { togglePlanActiveAction } from "@/features/commercial/actions";
import { formatPrice } from "@/features/products/format-price";
import type { PlanRowWithCounts } from "@/features/commercial/data";

export function PlanRow({ plan }: { plan: PlanRowWithCounts }) {
  const [isToggling, startToggle] = useTransition();

  return (
    <div className="grid grid-cols-12 items-center gap-4 px-6 py-4 transition-colors hover:bg-[#1E1E1E]">
      <div className="col-span-3">
        <div className="flex items-center gap-2 font-body text-body-md font-medium text-on-surface">
          {plan.name}
          {plan.is_featured ? (
            <span className="material-symbols-outlined text-[16px] text-tertiary" title="Destaque comercial">
              star
            </span>
          ) : null}
        </div>
        <div className="font-body text-body-sm text-on-surface-variant">{plan.slug}</div>
      </div>
      <div className="col-span-2 font-body text-body-sm text-on-surface-variant">
        {plan.monthly_price !== null ? `${formatPrice(plan.monthly_price)}/mês` : "A definir"}
      </div>
      <div className="col-span-2 font-body text-body-sm text-on-surface-variant">
        {plan.yearly_price !== null ? `${formatPrice(plan.yearly_price)}/ano` : "A definir"}
      </div>
      <div className="col-span-2 text-center font-label text-label-md text-on-surface-variant">
        {plan.feature_count} recurso(s)
      </div>
      <div className="col-span-1 flex justify-center">
        <span
          className={
            plan.is_active
              ? "rounded-full bg-emerald-500/10 px-2 py-1 font-label text-label-sm uppercase text-emerald-400"
              : "rounded-full bg-surface-container-highest px-2 py-1 font-label text-label-sm uppercase text-on-surface-variant"
          }
        >
          {plan.is_active ? "Ativo" : "Inativo"}
        </span>
      </div>
      <div className="col-span-2 flex justify-end gap-1">
        <Link
          className="rounded p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-tertiary"
          href={`/master/planos/${plan.id}`}
          title="Ver recursos"
        >
          <span className="material-symbols-outlined text-[20px]">toggle_on</span>
        </Link>
        <PlanFormDialog
          plan={plan}
          trigger={
            <span
              className="block rounded p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-tertiary"
              title="Editar"
            >
              <span className="material-symbols-outlined text-[20px]">edit</span>
            </span>
          }
        />
        <button
          className="rounded p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-tertiary disabled:opacity-50"
          disabled={isToggling}
          onClick={() =>
            startToggle(async () => {
              await togglePlanActiveAction(plan.id, !plan.is_active);
            })
          }
          title={plan.is_active ? "Desativar" : "Ativar"}
          type="button"
        >
          <span className="material-symbols-outlined text-[20px]">power_settings_new</span>
        </button>
      </div>
    </div>
  );
}
