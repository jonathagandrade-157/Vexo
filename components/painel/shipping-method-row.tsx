"use client";

import { useTransition } from "react";

import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { ShippingMethodFormDialog } from "@/components/painel/shipping-method-form-dialog";
import { formatPrice } from "@/features/products/format-price";
import { deleteShippingMethodAction, toggleShippingMethodStatusAction } from "@/features/shipping/actions";

export interface ShippingMethodRowData {
  id: string;
  name: string;
  price: number;
  estimated_days: number | null;
  status: "active" | "inactive";
  sort_order: number;
}

export function ShippingMethodRow({ method, canManage }: { method: ShippingMethodRowData; canManage: boolean }) {
  const [isToggling, startToggle] = useTransition();
  const active = method.status === "active";

  return (
    <div className="grid grid-cols-12 items-center gap-4 px-6 py-4 transition-colors hover:bg-[#1E1E1E]">
      <div className="col-span-4 flex items-center gap-3 md:col-span-5">
        <div className="flex h-8 w-8 items-center justify-center rounded border border-outline-variant bg-surface-container-highest">
          <span className="material-symbols-outlined text-[18px] text-primary">local_shipping</span>
        </div>
        <span className="font-body text-body-md font-medium text-on-surface">{method.name}</span>
      </div>
      <div className="col-span-2 text-center font-label text-label-md text-on-surface-variant">
        {method.price === 0 ? "Grátis" : formatPrice(method.price)}
      </div>
      <div className="col-span-2 text-center font-label text-label-md text-on-surface-variant">
        {method.estimated_days ? `${method.estimated_days} dia(s)` : "—"}
      </div>
      <div className="col-span-2 flex justify-center md:col-span-1">
        <span
          className={
            active
              ? "rounded-full bg-emerald-500/10 px-2 py-1 font-label text-label-sm uppercase text-emerald-400"
              : "rounded-full bg-surface-container-highest px-2 py-1 font-label text-label-sm uppercase text-on-surface-variant"
          }
        >
          {active ? "Ativa" : "Inativa"}
        </span>
      </div>
      {canManage ? (
        <div className="col-span-2 flex justify-end gap-1">
          <button
            className="rounded p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-primary disabled:opacity-50"
            disabled={isToggling}
            onClick={() =>
              startToggle(async () => {
                await toggleShippingMethodStatusAction(method.id, active ? "inactive" : "active");
              })
            }
            title={active ? "Desativar" : "Ativar"}
            type="button"
          >
            <span className="material-symbols-outlined text-[20px]">power_settings_new</span>
          </button>
          <ShippingMethodFormDialog
            method={method}
            trigger={
              <span
                className="block rounded p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-primary"
                title="Editar"
              >
                <span className="material-symbols-outlined text-[20px]">edit</span>
              </span>
            }
          />
          <ConfirmDialog
            confirmLabel="Excluir"
            description={`Tem certeza que deseja excluir "${method.name}"? Essa ação não pode ser desfeita.`}
            onConfirm={() => deleteShippingMethodAction(method.id)}
            title="Excluir modalidade"
            trigger={
              <span
                className="block rounded p-1.5 text-on-surface-variant transition-colors hover:bg-error-container/20 hover:text-error"
                title="Excluir"
              >
                <span className="material-symbols-outlined text-[20px]">delete</span>
              </span>
            }
          />
        </div>
      ) : null}
    </div>
  );
}
