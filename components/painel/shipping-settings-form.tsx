"use client";

import { useActionState, useTransition } from "react";
import { useFormStatus } from "react-dom";

import { TextField } from "@/components/ui/text-field";
import { toggleShippingEnabledAction, updateShippingSettingsAction } from "@/features/shipping/actions";
import { initialShippingSettingsState } from "@/features/shipping/schema";

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

/** Liga/desliga a entrega da loja — ação própria e imediata (mesmo padrão do toggle de status de categoria), não um campo dentro do form de CEP de origem. */
function EnabledToggle({ enabled, canManage }: { enabled: boolean; canManage: boolean }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      aria-pressed={enabled}
      className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        enabled ? "border-primary/40 bg-primary/10" : "border-outline-variant/50 bg-surface-container-lowest"
      }`}
      disabled={!canManage || isPending}
      onClick={() =>
        startTransition(async () => {
          await toggleShippingEnabledAction(!enabled);
        })
      }
      type="button"
    >
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? "bg-primary" : "bg-surface-container-highest"}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`}
        />
      </span>
      <span className="flex flex-col">
        <span className="font-label text-label-md text-on-surface">
          {enabled ? "Entrega habilitada" : "Entrega desabilitada"}
        </span>
        <span className="font-body text-body-sm text-on-surface-variant">
          {enabled
            ? "Os clientes veem as modalidades de entrega abaixo no checkout."
            : "O checkout não exige frete enquanto estiver desligado."}
        </span>
      </span>
    </button>
  );
}

export function ShippingSettingsForm({
  canManage,
  enabled,
  originZip,
}: {
  canManage: boolean;
  enabled: boolean;
  originZip: string | null;
}) {
  const [state, formAction] = useActionState(updateShippingSettingsAction, initialShippingSettingsState);

  return (
    <section className="flex flex-col gap-5 rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
      <div>
        <h2 className="font-headline text-headline-sm text-on-surface">Entrega</h2>
        <p className="mt-1 font-body text-body-sm text-on-surface-variant">
          Habilite a entrega e informe o CEP de origem da loja (usado no futuro para integrações reais de
          transportadora).
        </p>
      </div>

      <EnabledToggle canManage={canManage} enabled={enabled} />

      <form action={formAction} className="flex flex-col gap-4 sm:flex-row sm:items-end" noValidate>
        <div className="flex-1">
          <TextField
            defaultValue={originZip ?? undefined}
            disabled={!canManage}
            error={state.fieldErrors?.originZip}
            icon="pin_drop"
            id="originZip"
            label="CEP de origem (opcional)"
            name="originZip"
            placeholder="00000-000"
            required={false}
          />
        </div>
        {canManage ? <SaveButton /> : null}
      </form>

      {state.status === "error" && state.message ? (
        <p className="rounded-lg border border-error/30 bg-error-container/10 px-3 py-2 font-body text-body-sm text-error" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.status === "success" ? (
        <p className="font-body text-body-sm text-emerald-400">{state.message}</p>
      ) : null}
    </section>
  );
}
