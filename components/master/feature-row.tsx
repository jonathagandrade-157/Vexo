"use client";

import { useTransition } from "react";

import { FeatureFormDialog } from "@/components/master/feature-form-dialog";
import { toggleFeatureActiveAction } from "@/features/commercial/actions";
import type { FeatureRow as FeatureRowData } from "@/features/commercial/data";

export function FeatureRow({ feature }: { feature: FeatureRowData }) {
  const [isToggling, startToggle] = useTransition();

  return (
    <div className="grid grid-cols-12 items-center gap-4 px-6 py-4 transition-colors hover:bg-[#1E1E1E]">
      <div className="col-span-4">
        <div className="font-body text-body-md font-medium text-on-surface">{feature.name}</div>
        <div className="font-body text-body-sm text-on-surface-variant">{feature.key}</div>
      </div>
      <div className="col-span-3 font-body text-body-sm text-on-surface-variant">{feature.category ?? "—"}</div>
      <div className="col-span-3 truncate font-body text-body-sm text-on-surface-variant">{feature.description ?? "—"}</div>
      <div className="col-span-1 flex justify-center">
        <span
          className={
            feature.is_active
              ? "rounded-full bg-emerald-500/10 px-2 py-1 font-label text-label-sm uppercase text-emerald-400"
              : "rounded-full bg-surface-container-highest px-2 py-1 font-label text-label-sm uppercase text-on-surface-variant"
          }
        >
          {feature.is_active ? "Ativo" : "Inativo"}
        </span>
      </div>
      <div className="col-span-1 flex justify-end gap-1">
        <FeatureFormDialog
          feature={feature}
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
              await toggleFeatureActiveAction(feature.id, !feature.is_active);
            })
          }
          title={feature.is_active ? "Desativar" : "Ativar"}
          type="button"
        >
          <span className="material-symbols-outlined text-[20px]">power_settings_new</span>
        </button>
      </div>
    </div>
  );
}
