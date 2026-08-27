"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { TextField } from "@/components/ui/text-field";
import { updateOwnDeliverySettingsAction } from "@/features/shipping/actions";
import { initialOwnDeliverySettingsState } from "@/features/shipping/schema";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className="rounded-lg bg-primary-container px-5 py-2.5 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? "Salvando…" : "Salvar"}
    </button>
  );
}

/** Mesmo padrão visual de EnabledToggle (ShippingSettingsForm/PixSettingsForm) — checkbox oculto + trilho estilizado, salvo junto com o resto do form. */
function ActiveToggle({ active, onToggle, canManage }: { active: boolean; onToggle: (next: boolean) => void; canManage: boolean }) {
  return (
    <label
      className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
        active ? "border-primary/40 bg-primary/10" : "border-outline-variant/50 bg-surface-container-lowest"
      } ${!canManage ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
    >
      <input checked={active} className="sr-only" disabled={!canManage} name="active" onChange={(e) => onToggle(e.target.checked)} type="checkbox" />
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${active ? "bg-primary" : "bg-surface-container-highest"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${active ? "translate-x-5" : "translate-x-0.5"}`} />
      </span>
      <span className="flex flex-col">
        <span className="font-label text-label-md text-on-surface">{active ? "Entrega própria ativa" : "Entrega própria desativada"}</span>
        <span className="font-body text-body-sm text-on-surface-variant">
          {active ? "Os clientes veem esta opção no checkout." : "Esta opção fica oculta no checkout."}
        </span>
      </span>
    </label>
  );
}

/**
 * D3.1 §3/§8 — "☑ Entrega própria: Nome, Preço, Prazo, Ativo". Preço fixo
 * nesta primeira versão (sem distância/raio/regiões — prompt §3/§15),
 * sempre revalidado no servidor antes de aplicar a um pedido (mesma
 * garantia de `apply_shipping_to_order` já usada por `flat_rate`).
 * Configuração única por tenant (não uma lista).
 */
export function OwnDeliverySettingsForm({
  canManage,
  initialName,
  initialPrice,
  initialEstimatedDays,
  initialActive,
}: {
  canManage: boolean;
  initialName: string;
  initialPrice: number;
  initialEstimatedDays: number | null;
  initialActive: boolean;
}) {
  const [state, formAction] = useActionState(updateOwnDeliverySettingsAction, initialOwnDeliverySettingsState);
  const [active, setActive] = useState(initialActive);

  return (
    <form action={formAction} className="flex flex-col gap-5 rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
      <div>
        <h2 className="font-headline text-headline-sm text-on-surface">🚚 Entrega própria</h2>
        <p className="mt-1 font-body text-body-sm text-on-surface-variant">
          Entrega feita pela própria loja, com preço fixo — sem cálculo por distância ou raio nesta versão.
        </p>
      </div>

      <ActiveToggle active={active} canManage={canManage} onToggle={setActive} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <TextField
            defaultValue={initialName}
            disabled={!canManage}
            error={state.fieldErrors?.name}
            icon="local_shipping"
            id="ownDeliveryName"
            label="Nome"
            name="name"
            placeholder="Entrega própria"
          />
        </div>
        <TextField
          defaultValue={initialPrice.toString()}
          disabled={!canManage}
          error={state.fieldErrors?.price}
          icon="payments"
          id="ownDeliveryPrice"
          label="Preço (R$)"
          name="price"
          placeholder="0,00"
          type="number"
        />
        <TextField
          defaultValue={initialEstimatedDays?.toString() ?? undefined}
          disabled={!canManage}
          error={state.fieldErrors?.estimatedDays}
          icon="schedule"
          id="ownDeliveryEstimatedDays"
          label="Prazo (dias úteis, opcional)"
          name="estimatedDays"
          placeholder="2"
          required={false}
          type="number"
        />
      </div>

      {state.status === "error" && state.message ? (
        <p className="rounded-lg border border-error/30 bg-error-container/10 px-3 py-2 font-body text-body-sm text-error" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.status === "success" ? <p className="font-body text-body-sm text-emerald-400">{state.message}</p> : null}

      {canManage ? (
        <div>
          <SaveButton />
        </div>
      ) : null}
    </form>
  );
}
