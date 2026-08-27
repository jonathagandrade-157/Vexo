"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { updateCheckoutModeAction } from "@/features/settings/checkout-actions";
import {
  CHECKOUT_MODES,
  CHECKOUT_MODE_DESCRIPTIONS,
  CHECKOUT_MODE_LABELS,
  initialCheckoutModeState,
  type CheckoutMode,
} from "@/features/settings/checkout-schema";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className="w-fit rounded-lg bg-primary-container px-5 py-2.5 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? "Salvando…" : "Salvar"}
    </button>
  );
}

/**
 * Fase D1. "Como deseja receber seus pedidos?" — 3 opções fechadas
 * (CHECKOUT_MODES), mesmo padrão visual de rádio já usado em
 * `checkout-form.tsx` (seleção de frete no storefront). Salvar aqui não
 * muda nenhum comportamento visível do checkout ainda — só grava a
 * preferência para quando o fluxo WhatsApp (Fase D2) existir.
 */
export function CheckoutModeForm({ canEdit, currentMode }: { canEdit: boolean; currentMode: CheckoutMode }) {
  const [state, formAction] = useActionState(updateCheckoutModeAction, initialCheckoutModeState);
  const [selected, setSelected] = useState<CheckoutMode>(currentMode);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-5 rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6"
    >
      <div>
        <h2 className="font-headline text-headline-sm text-on-surface">Como deseja receber seus pedidos?</h2>
        <p className="mt-1 font-body text-body-sm text-on-surface-variant">
          Escolha como os clientes finalizam a compra na sua loja.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {CHECKOUT_MODES.map((mode) => (
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors ${
              selected === mode ? "border-primary/50 bg-primary/10" : "border-outline-variant/40 bg-surface-container-lowest"
            } ${!canEdit ? "cursor-not-allowed opacity-60" : ""}`}
            key={mode}
          >
            <input
              checked={selected === mode}
              className="mt-1 h-4 w-4 accent-primary"
              disabled={!canEdit}
              name="checkoutMode"
              onChange={() => setSelected(mode)}
              type="radio"
              value={mode}
            />
            <span className="flex flex-col">
              <span className="font-label text-label-md text-on-surface">{CHECKOUT_MODE_LABELS[mode]}</span>
              <span className="font-body text-body-sm text-on-surface-variant">{CHECKOUT_MODE_DESCRIPTIONS[mode]}</span>
            </span>
          </label>
        ))}
      </div>

      {state.status === "error" && state.message ? (
        <p className="rounded-lg border border-error/30 bg-error-container/10 px-3 py-2 font-body text-body-sm text-error" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.status === "success" && state.message ? (
        <p className="font-body text-body-sm text-emerald-400" role="status">
          {state.message}
        </p>
      ) : null}

      {canEdit ? <SaveButton /> : null}
    </form>
  );
}
