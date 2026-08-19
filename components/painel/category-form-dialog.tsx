"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

import { TextField } from "@/components/ui/text-field";
import { TextareaField } from "@/components/ui/textarea-field";
import { createCategoryAction, updateCategoryAction } from "@/features/categories/actions";
import { initialCategoryState } from "@/features/categories/schema";

function SaveButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      className="rounded-lg bg-primary-container px-5 py-2.5 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

interface CategoryFormDialogProps {
  trigger: React.ReactNode;
  category?: { id: string; name: string; description: string | null };
}

/** Cria OU edita — mesmo form, Action escolhida por `mode` (prompt Etapa 7 §18: reaproveitar, não duplicar componente). */
export function CategoryFormDialog({ trigger, category }: CategoryFormDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const action = category ? updateCategoryAction : createCategoryAction;
  const [state, formAction] = useActionState(action, initialCategoryState);

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
          <h2 className="font-headline text-headline-sm text-on-surface">
            {category ? "Editar categoria" : "Nova categoria"}
          </h2>

          {category ? <input name="categoryId" type="hidden" value={category.id} /> : null}

          <TextField
            defaultValue={category?.name}
            error={state.fieldErrors?.name}
            icon="sell"
            id="name"
            label="Nome da categoria"
            name="name"
            placeholder="Ex: Perfumes"
          />
          <TextareaField
            defaultValue={category?.description ?? undefined}
            error={state.fieldErrors?.description}
            id="description"
            label="Descrição (opcional)"
            name="description"
          />

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
            <SaveButton label={category ? "Salvar alterações" : "Criar categoria"} pendingLabel="Salvando…" />
          </div>
        </form>
      </dialog>
    </>
  );
}
