"use client";

import { useActionState, useTransition } from "react";
import { useFormStatus } from "react-dom";

import { deletePlanLimitAction, upsertPlanLimitAction } from "@/features/commercial/actions";
import { initialPlanLimitState } from "@/features/commercial/schema";
import type { PlanLimitRow } from "@/features/commercial/data";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className="rounded-lg bg-tertiary-container px-4 py-2.5 font-label text-label-sm text-on-tertiary-container transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? "Salvando…" : "Salvar limite"}
    </button>
  );
}

function LimitRow({ planId, limit }: { planId: string; limit: PlanLimitRow }) {
  const [isDeleting, startDelete] = useTransition();

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-4 py-3">
      <div>
        <p className="font-body text-body-sm text-on-surface">{limit.limit_key}</p>
        <p className="font-body text-body-sm text-on-surface-variant">
          {limit.limit_value === -1 ? "Ilimitado" : limit.limit_value}
        </p>
      </div>
      <button
        className="rounded p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-error disabled:opacity-50"
        disabled={isDeleting}
        onClick={() =>
          startDelete(async () => {
            await deletePlanLimitAction(planId, limit.id);
          })
        }
        title="Remover"
        type="button"
      >
        <span className="material-symbols-outlined text-[20px]">delete</span>
      </button>
    </div>
  );
}

/**
 * Feature ≠ limite (ajuste arquitetural pedido explicitamente) — aqui
 * não há um catálogo fixo de chaves como `features` tem: `limitKey` é
 * texto livre (snake_case), o MASTER cadastra a chave que precisar, sem
 * migration nova (mesmo princípio de extensibilidade de `features`).
 * Só o mecanismo é construído nesta etapa — nenhuma funcionalidade
 * existente aplica esses limites ainda.
 */
export function PlanLimitsEditor({ planId, limits }: { planId: string; limits: PlanLimitRow[] }) {
  const action = upsertPlanLimitAction.bind(null, planId);
  const [state, formAction] = useActionState(action, initialPlanLimitState);

  return (
    <div className="flex flex-col gap-4">
      {limits.length === 0 ? (
        <p className="font-body text-body-sm text-on-surface-variant">Nenhum limite configurado para este plano ainda.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {limits.map((limit) => (
            <LimitRow key={limit.id} limit={limit} planId={planId} />
          ))}
        </div>
      )}

      <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="mb-1.5 block font-label text-label-md uppercase text-on-surface-variant" htmlFor="limitKey">
            Chave do limite
          </label>
          <input
            className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
            id="limitKey"
            name="limitKey"
            placeholder="ex: products_limit"
            required
            type="text"
          />
          {state.fieldErrors?.limitKey ? <p className="mt-1 text-label-sm text-error">{state.fieldErrors.limitKey}</p> : null}
        </div>
        <div className="sm:w-48">
          <label className="mb-1.5 block font-label text-label-md uppercase text-on-surface-variant" htmlFor="limitValue">
            Valor (-1 = ilimitado)
          </label>
          <input
            className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
            id="limitValue"
            min="-1"
            name="limitValue"
            placeholder="100"
            required
            type="number"
          />
          {state.fieldErrors?.limitValue ? <p className="mt-1 text-label-sm text-error">{state.fieldErrors.limitValue}</p> : null}
        </div>
        <SaveButton />
      </form>

      {state.status === "error" && state.message ? (
        <p className="rounded-lg border border-error/30 bg-error-container/10 px-3 py-2 font-body text-body-sm text-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
