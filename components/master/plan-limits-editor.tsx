"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";

import { deletePlanLimitAction, upsertPlanLimitAction } from "@/features/commercial/actions";
import { initialPlanLimitState } from "@/features/commercial/schema";
import type { PlanLimitRow } from "@/features/commercial/data";

/** Rótulo amigável para as chaves já conhecidas (Etapa 20 §5) — só apresentação; `limitKey` continua sendo texto livre no banco, nenhuma chave nova precisa ser cadastrada aqui para funcionar (mesmo princípio de extensibilidade sem migration). */
const LIMIT_LABELS: Record<string, string> = {
  products_limit: "Produtos",
  categories_limit: "Categorias",
};

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
        <p className="font-body text-body-sm text-on-surface">{LIMIT_LABELS[limit.limit_key] ?? limit.limit_key}</p>
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
 * Os limites já são aplicados de verdade pelos triggers de enforcement
 * de `products`/`categories` (Etapa 16, migration 20260817220065) —
 * reduzir um limite aqui nunca apaga dados existentes, só bloqueia
 * criações futuras além do novo teto (mesmo comportamento dos triggers).
 */
export function PlanLimitsEditor({ planId, limits }: { planId: string; limits: PlanLimitRow[] }) {
  const action = upsertPlanLimitAction.bind(null, planId);
  const [state, formAction] = useActionState(action, initialPlanLimitState);
  const [unlimited, setUnlimited] = useState(false);

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
        <div className="sm:w-40">
          <label className="mb-1.5 block font-label text-label-md uppercase text-on-surface-variant" htmlFor="limitValue">
            Valor
          </label>
          {unlimited ? (
            <input
              className="w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface-variant"
              disabled
              value="Ilimitado"
            />
          ) : (
            <input
              className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
              id="limitValue"
              min="0"
              name="limitValue"
              placeholder="100"
              required
              type="number"
            />
          )}
          {/* -1 = ilimitado (sentinel do banco, migration 20260817220058) — o checkbox só evita o MASTER ter que saber/digitar esse número mágico. */}
          {unlimited ? <input name="limitValue" type="hidden" value="-1" /> : null}
          {state.fieldErrors?.limitValue ? <p className="mt-1 text-label-sm text-error">{state.fieldErrors.limitValue}</p> : null}
        </div>
        <label className="flex items-center gap-2 pb-2.5 font-body text-body-sm text-on-surface-variant sm:pb-0">
          <input
            checked={unlimited}
            className="h-4 w-4 accent-tertiary"
            onChange={(e) => setUnlimited(e.target.checked)}
            type="checkbox"
          />
          Ilimitado
        </label>
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
