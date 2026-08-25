"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

import { initialTenantPlanState, updateTenantPlanAction } from "@/features/master/tenants-actions";
import { formatPrice } from "@/features/products/format-price";

export interface ActivePlanOption {
  id: string;
  name: string;
  monthlyPrice: number | null;
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className="rounded-lg bg-tertiary-container px-5 py-2.5 font-label text-label-md text-on-tertiary-container transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? "Salvando…" : "Confirmar alteração"}
    </button>
  );
}

/**
 * Etapa 20.1 — dialog de troca de plano em `/master/lojas/[id]`. Só lista
 * planos ativos (mesmo princípio de `listPublicPlans`: um plano
 * desativado nunca deve virar uma opção atribuível), preço "A definir"
 * quando `monthly_price` é `null` — nunca um valor inventado.
 */
export function TenantPlanDialog({
  tenantId,
  currentPlanId,
  plans,
}: {
  tenantId: string;
  currentPlanId: string | null;
  plans: ActivePlanOption[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const action = updateTenantPlanAction.bind(null, tenantId);
  const [state, formAction] = useActionState(action, initialTenantPlanState);

  useEffect(() => {
    if (state.status === "success") dialogRef.current?.close();
  }, [state.status]);

  return (
    <>
      <button
        className="rounded-lg border border-tertiary/40 px-4 py-2 font-label text-label-md text-tertiary transition-colors hover:bg-tertiary/10"
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        Alterar plano
      </button>
      <dialog
        className="w-full max-w-[440px] rounded-xl border border-surface-container-highest bg-surface-container-low p-0 text-on-surface backdrop:bg-black/60"
        ref={dialogRef}
      >
        <form action={formAction} className="flex flex-col gap-5 p-6">
          <h2 className="font-headline text-headline-sm text-on-surface">Alterar plano da loja</h2>

          <div className="flex flex-col gap-1.5">
            <label className="font-label text-label-md uppercase text-on-surface-variant" htmlFor="planId">
              Novo plano
            </label>
            <select
              className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
              defaultValue={currentPlanId ?? ""}
              id="planId"
              name="planId"
              required
            >
              <option disabled value="">
                Selecione um plano
              </option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} — {plan.monthlyPrice !== null ? `${formatPrice(plan.monthlyPrice)}/mês` : "R$ A definir"}
                </option>
              ))}
            </select>
          </div>

          {state.status === "success" && state.message ? (
            <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 font-body text-body-sm text-emerald-400" role="status">
              {state.message}
            </p>
          ) : null}
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
            <SaveButton />
          </div>
        </form>
      </dialog>
    </>
  );
}
