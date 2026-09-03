"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { BUSINESS_TYPE_CHOICES } from "@/features/onboarding/business-type-choices";
import { saveBusinessTypeAction } from "@/features/onboarding/actions";
import { initialBusinessTypeState } from "@/features/onboarding/schema";

function ContinueButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className="flex items-center gap-2 rounded-lg bg-primary-container px-6 py-3 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? "Salvando…" : "Continuar"}
      {pending ? null : <span className="material-symbols-outlined text-[18px]">arrow_forward</span>}
    </button>
  );
}

/**
 * D15.1.1 — nova etapa "segmento", primeira do wizard. Só `ecommerce`
 * (`BUSINESS_TYPE_CHOICES`, features/onboarding/business-type-choices.ts)
 * é selecionável hoje; restaurant/adega aparecem visualmente como "Em
 * breve" — cartões desabilitados de verdade (`disabled` no `<input>`),
 * não só estilizados como se estivessem, então nem um clique consegue
 * marcá-los. `saveBusinessTypeAction` nunca confia só nisso e revalida no
 * servidor (`isSelectableBusinessType`).
 */
export function BusinessTypeForm() {
  const [state, formAction] = useActionState(saveBusinessTypeAction, initialBusinessTypeState);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {BUSINESS_TYPE_CHOICES.map((choice) => (
          <label
            className={
              choice.enabled
                ? "flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-surface-container-highest px-4 py-8 text-center font-label text-label-md text-on-surface-variant transition-colors has-[:checked]:border-2 has-[:checked]:border-primary has-[:checked]:bg-primary-container/10 has-[:checked]:text-on-surface hover:border-primary/50 hover:text-on-surface"
                : "flex cursor-not-allowed flex-col items-center gap-2 rounded-lg border border-surface-container-highest px-4 py-8 text-center font-label text-label-md text-on-surface-variant opacity-50"
            }
            key={choice.value}
          >
            <input
              className="sr-only"
              defaultChecked={choice.value === "ecommerce"}
              disabled={!choice.enabled}
              name="businessType"
              type="radio"
              value={choice.value}
            />
            <span className="text-4xl">{choice.icon}</span>
            <span>{choice.label}</span>
            {!choice.enabled ? <span className="text-[10px] uppercase tracking-wider">Em breve</span> : null}
          </label>
        ))}
      </div>

      {state.status === "error" && state.message ? (
        <p className="rounded-lg border border-error/30 bg-error-container/10 px-4 py-2 text-body-sm text-error" role="alert">
          {state.message}
        </p>
      ) : null}

      <div className="mt-2 flex justify-end border-t border-outline-variant/20 pt-6">
        <ContinueButton />
      </div>
    </form>
  );
}
