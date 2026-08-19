"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

import { TextField } from "@/components/ui/text-field";
import { createPlanAction, updatePlanAction } from "@/features/commercial/actions";
import { initialPlanState } from "@/features/commercial/schema";
import type { PlanRowWithCounts } from "@/features/commercial/data";

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      className="rounded-lg bg-tertiary-container px-5 py-2.5 font-label text-label-md text-on-tertiary-container transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? "Salvando…" : label}
    </button>
  );
}

/** Cria OU edita — mesmo padrão de CategoryFormDialog (Etapa 7)/ShippingMethodFormDialog (Etapa 12), com o acento `tertiary` do shell MASTER. Preço fica opcional (prompt Etapa 14 §4). */
export function PlanFormDialog({ trigger, plan }: { trigger: React.ReactNode; plan?: PlanRowWithCounts }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const action = plan ? updatePlanAction.bind(null, plan.id) : createPlanAction;
  const [state, formAction] = useActionState(action, initialPlanState);

  useEffect(() => {
    if (state.status === "success") dialogRef.current?.close();
  }, [state.status]);

  return (
    <>
      <button onClick={() => dialogRef.current?.showModal()} type="button">
        {trigger}
      </button>
      <dialog
        className="w-full max-w-[560px] rounded-xl border border-surface-container-highest bg-surface-container-low p-0 text-on-surface backdrop:bg-black/60"
        ref={dialogRef}
      >
        <form action={formAction} className="flex flex-col gap-5 p-6" noValidate>
          <h2 className="font-headline text-headline-sm text-on-surface">{plan ? "Editar plano" : "Novo plano"}</h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField
              defaultValue={plan?.name}
              error={state.fieldErrors?.name}
              icon="workspace_premium"
              id="name"
              label="Nome"
              name="name"
              placeholder="Ex: Intermediário"
            />
            <TextField
              defaultValue={plan?.slug}
              error={state.fieldErrors?.slug}
              icon="tag"
              id="slug"
              label="Slug"
              name="slug"
              placeholder="ex: intermediate"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-label text-label-md uppercase text-on-surface-variant" htmlFor="description">
              Descrição (opcional)
            </label>
            <textarea
              className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
              defaultValue={plan?.description ?? undefined}
              id="description"
              maxLength={500}
              name="description"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="font-label text-label-md uppercase text-on-surface-variant" htmlFor="monthlyPrice">
                Preço mensal (opcional)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-label text-label-md text-on-surface-variant">R$</span>
                <input
                  className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest py-2.5 pl-10 pr-3 font-body text-body-sm text-on-surface focus:outline-none"
                  defaultValue={plan?.monthly_price ?? undefined}
                  id="monthlyPrice"
                  min="0"
                  name="monthlyPrice"
                  placeholder="A definir"
                  step="0.01"
                  type="number"
                />
              </div>
              {state.fieldErrors?.monthlyPrice ? <p className="text-label-sm text-error">{state.fieldErrors.monthlyPrice}</p> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="font-label text-label-md uppercase text-on-surface-variant" htmlFor="yearlyPrice">
                Preço anual (opcional)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-label text-label-md text-on-surface-variant">R$</span>
                <input
                  className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest py-2.5 pl-10 pr-3 font-body text-body-sm text-on-surface focus:outline-none"
                  defaultValue={plan?.yearly_price ?? undefined}
                  id="yearlyPrice"
                  min="0"
                  name="yearlyPrice"
                  placeholder="A definir"
                  step="0.01"
                  type="number"
                />
              </div>
              {state.fieldErrors?.yearlyPrice ? <p className="text-label-sm text-error">{state.fieldErrors.yearlyPrice}</p> : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <TextField
              defaultValue={String(plan?.trial_days ?? 30)}
              error={state.fieldErrors?.trialDays}
              icon="hourglass_top"
              id="trialDays"
              label="Dias de trial"
              name="trialDays"
              type="number"
            />
            <TextField
              defaultValue={String(plan?.sort_order ?? 0)}
              error={state.fieldErrors?.sortOrder}
              icon="sort"
              id="sortOrder"
              label="Ordem de exibição"
              name="sortOrder"
              required={false}
              type="number"
            />
          </div>

          <label className="flex items-center gap-2 font-body text-body-sm text-on-surface">
            <input defaultChecked={plan?.is_featured} name="isFeatured" type="checkbox" />
            Destaque comercial (plano recomendado)
          </label>

          {state.status === "error" && state.message ? (
            <p className="rounded-lg border border-error/30 bg-error-container/10 px-3 py-2 font-body text-body-sm text-error" role="alert">
              {state.message}
            </p>
          ) : null}

          <div className="mt-1 flex justify-end gap-3">
            <button
              className="rounded-lg px-4 py-2.5 font-label text-label-md text-on-surface-variant transition-colors hover:text-on-surface"
              onClick={() => dialogRef.current?.close()}
              type="button"
            >
              Cancelar
            </button>
            <SaveButton label={plan ? "Salvar alterações" : "Criar plano"} />
          </div>
        </form>
      </dialog>
    </>
  );
}
