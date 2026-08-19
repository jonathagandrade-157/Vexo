"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

import { TextField } from "@/components/ui/text-field";
import { createFeatureAction, updateFeatureAction } from "@/features/commercial/actions";
import { initialFeatureState } from "@/features/commercial/schema";
import type { FeatureRow } from "@/features/commercial/data";

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

/** Cria OU edita um recurso (prompt Etapa 14 §18) — mesmo padrão de PlanFormDialog. `key` é a chave estável usada por tenant_has_feature(), nunca alterada silenciosamente sem o MASTER ver o que está mudando. */
export function FeatureFormDialog({ trigger, feature }: { trigger: React.ReactNode; feature?: FeatureRow }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const action = feature ? updateFeatureAction.bind(null, feature.id) : createFeatureAction;
  const [state, formAction] = useActionState(action, initialFeatureState);

  useEffect(() => {
    if (state.status === "success") dialogRef.current?.close();
  }, [state.status]);

  return (
    <>
      <button onClick={() => dialogRef.current?.showModal()} type="button">
        {trigger}
      </button>
      <dialog
        className="w-full max-w-[480px] rounded-xl border border-surface-container-highest bg-surface-container-low p-0 text-on-surface backdrop:bg-black/60"
        ref={dialogRef}
      >
        <form action={formAction} className="flex flex-col gap-5 p-6" noValidate>
          <h2 className="font-headline text-headline-sm text-on-surface">{feature ? "Editar recurso" : "Novo recurso"}</h2>

          <TextField
            defaultValue={feature?.name}
            error={state.fieldErrors?.name}
            icon="toggle_on"
            id="name"
            label="Nome"
            name="name"
            placeholder="Ex: Cupons"
          />
          <TextField
            defaultValue={feature?.key}
            error={state.fieldErrors?.key}
            icon="key"
            id="key"
            label="Chave (feature key)"
            name="key"
            placeholder="ex: coupons"
          />
          <TextField
            defaultValue={feature?.category ?? undefined}
            error={state.fieldErrors?.category}
            icon="category"
            id="category"
            label="Categoria (opcional)"
            name="category"
            placeholder="ex: marketing"
            required={false}
          />
          <div className="flex flex-col gap-1.5">
            <label className="font-label text-label-md uppercase text-on-surface-variant" htmlFor="description">
              Descrição (opcional)
            </label>
            <textarea
              className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
              defaultValue={feature?.description ?? undefined}
              id="description"
              maxLength={500}
              name="description"
              rows={2}
            />
          </div>

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
            <SaveButton label={feature ? "Salvar alterações" : "Criar recurso"} />
          </div>
        </form>
      </dialog>
    </>
  );
}
