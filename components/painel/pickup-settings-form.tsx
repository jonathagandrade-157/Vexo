"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { TextField } from "@/components/ui/text-field";
import { updatePickupSettingsAction } from "@/features/shipping/actions";
import { initialPickupSettingsState } from "@/features/shipping/schema";

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
        <span className="font-label text-label-md text-on-surface">{active ? "Retirada ativa" : "Retirada desativada"}</span>
        <span className="font-body text-body-sm text-on-surface-variant">
          {active ? "Os clientes veem esta opção no checkout." : "Esta opção fica oculta no checkout."}
        </span>
      </span>
    </label>
  );
}

/**
 * D3.1 §8 — "☑ Retirada na loja: Nome, Prazo/instrução, Ativo". Preço não
 * é um campo aqui: é sempre 0, garantido pelo banco
 * (shipping_methods_pickup_price_zero_check). Configuração única por
 * tenant (não uma lista) — o endereço mostrado ao cliente é sempre
 * `tenants.address_*`, nunca duplicado neste formulário.
 */
export function PickupSettingsForm({
  canManage,
  initialName,
  initialEstimatedDays,
  initialActive,
}: {
  canManage: boolean;
  initialName: string;
  initialEstimatedDays: number | null;
  initialActive: boolean;
}) {
  const [state, formAction] = useActionState(updatePickupSettingsAction, initialPickupSettingsState);
  const [active, setActive] = useState(initialActive);

  return (
    <form action={formAction} className="flex flex-col gap-5 rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
      <div>
        <h2 className="font-headline text-headline-sm text-on-surface">🏪 Retirada na loja</h2>
        <p className="mt-1 font-body text-body-sm text-on-surface-variant">
          O cliente retira o pedido no endereço da loja (Configurações da loja) — sem custo e sem precisar informar
          endereço de entrega.
        </p>
      </div>

      <ActiveToggle active={active} canManage={canManage} onToggle={setActive} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          defaultValue={initialName}
          disabled={!canManage}
          error={state.fieldErrors?.name}
          icon="storefront"
          id="pickupName"
          label="Nome"
          name="name"
          placeholder="Retirar na loja"
        />
        <TextField
          defaultValue={initialEstimatedDays?.toString() ?? undefined}
          disabled={!canManage}
          error={state.fieldErrors?.estimatedDays}
          icon="schedule"
          id="pickupEstimatedDays"
          label="Prazo (dias úteis, opcional)"
          name="estimatedDays"
          placeholder="1"
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
