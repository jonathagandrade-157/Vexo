"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

import { TextField } from "@/components/ui/text-field";
import { createShippingMethodAction, updateShippingMethodAction } from "@/features/shipping/actions";
import { initialShippingMethodState } from "@/features/shipping/schema";

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

interface ShippingMethodFormDialogProps {
  trigger: React.ReactNode;
  method?: { id: string; name: string; price: number; estimated_days: number | null; sort_order: number };
}

/** Cria OU edita — mesmo form, Action escolhida pela presença de `method` (mesmo padrão de CategoryFormDialog, Etapa 7). Só `flat_rate` nesta etapa — `type` nem aparece no formulário (prompt §6/§27: não inventar transportadora real). */
export function ShippingMethodFormDialog({ trigger, method }: ShippingMethodFormDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const action = method ? updateShippingMethodAction : createShippingMethodAction;
  const [state, formAction] = useActionState(action, initialShippingMethodState);

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
            {method ? "Editar modalidade de entrega" : "Nova modalidade de entrega"}
          </h2>

          {method ? <input name="methodId" type="hidden" value={method.id} /> : null}

          <TextField
            defaultValue={method?.name}
            error={state.fieldErrors?.name}
            icon="local_shipping"
            id="name"
            label="Nome"
            name="name"
            placeholder="Ex: Entrega padrão"
          />

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="font-label text-label-md uppercase text-on-surface-variant" htmlFor="price">
                Preço
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-label text-label-md text-on-surface-variant">
                  R$
                </span>
                <input
                  className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest py-2.5 pl-10 pr-3 font-body text-body-sm text-on-surface focus:outline-none"
                  defaultValue={method?.price}
                  id="price"
                  min="0"
                  name="price"
                  placeholder="0,00"
                  required
                  step="0.01"
                  type="number"
                />
              </div>
              {state.fieldErrors?.price ? <p className="text-label-sm text-error">{state.fieldErrors.price}</p> : null}
              <p className="font-body text-body-sm text-on-surface-variant">Use 0,00 para frete grátis.</p>
            </div>

            <TextField
              defaultValue={method?.estimated_days != null ? String(method.estimated_days) : undefined}
              error={state.fieldErrors?.estimatedDays}
              icon="event"
              id="estimatedDays"
              label="Prazo (dias, opcional)"
              name="estimatedDays"
              placeholder="Ex: 5"
              required={false}
              type="number"
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
            <SaveButton label={method ? "Salvar alterações" : "Criar modalidade"} pendingLabel="Salvando…" />
          </div>
        </form>
      </dialog>
    </>
  );
}
