"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";

import { TextField } from "@/components/ui/text-field";
import { lookupStoreAddressAction, updateStoreAddressAction } from "@/features/settings/address-actions";
import { initialStoreAddressState } from "@/features/settings/address-schema";
import { BRAZILIAN_STATES } from "@/lib/br/states";

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

function formatZipDisplay(digits: string): string {
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

interface DefaultValues {
  zip: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
}

/**
 * Fase D2-B.2 — endereço/origem da loja. Fonte única para PIX (Merchant
 * City do BR Code, fase futura)/entrega própria/Melhor Envio (futuro) —
 * nunca um campo isolado tipo `pix_recipient_city`. Autofill de CEP é
 * pontual (botão "Buscar", chamado uma vez por CEP digitado) — nunca
 * automático a cada tecla, nunca no checkout do cliente. `number`/
 * `complement` nunca vêm do autofill — sempre digitados aqui.
 *
 * `TextField` é não controlado (só `defaultValue`) — para os campos que o
 * autofill pode preencher (logradouro/bairro/cidade/UF), uso `key` presa a
 * `lookupVersion`: só muda (remontando o input com o novo `defaultValue`)
 * quando uma busca de CEP realmente atualiza os campos, nunca a cada tecla
 * digitada pelo lojista.
 */
export function StoreAddressForm({ canEdit, defaultValues }: { canEdit: boolean; defaultValues: DefaultValues }) {
  const [state, formAction] = useActionState(updateStoreAddressAction, initialStoreAddressState);
  const [isLookingUp, startLookup] = useTransition();
  const [zip, setZip] = useState(defaultValues.zip);
  const [lookupNotice, setLookupNotice] = useState<string | null>(null);
  const [lookupVersion, setLookupVersion] = useState(0);
  const [fields, setFields] = useState({
    street: defaultValues.street,
    neighborhood: defaultValues.neighborhood,
    city: defaultValues.city,
    state: defaultValues.state,
  });

  function handleLookup() {
    setLookupNotice(null);
    startLookup(async () => {
      const result = await lookupStoreAddressAction(zip);
      if (result.status === "found" && result.data) {
        setFields((f) => ({
          street: result.data!.street || f.street,
          neighborhood: result.data!.neighborhood || f.neighborhood,
          city: result.data!.city,
          state: result.data!.state,
        }));
        setLookupVersion((v) => v + 1);
      } else {
        setLookupNotice("Não foi possível buscar automaticamente. Preencha os campos manualmente.");
      }
    });
  }

  return (
    <form action={formAction} className="flex flex-col gap-5 rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
      <div>
        <h2 className="font-headline text-headline-sm text-on-surface">Endereço da loja</h2>
        <p className="mt-1 font-body text-body-sm text-on-surface-variant">
          Usado como origem da loja para PIX, entrega e futuras integrações de logística.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <TextField
            defaultValue={formatZipDisplay(defaultValues.zip)}
            disabled={!canEdit}
            error={state.fieldErrors?.zip}
            icon="pin_drop"
            id="zip"
            label="CEP"
            name="zip"
            onChange={(v) => setZip(v.replace(/\D/g, ""))}
            placeholder="00000-000"
            required={false}
          />
        </div>
        {canEdit ? (
          <button
            className="h-fit rounded-lg border border-outline-variant/50 px-4 py-3 font-label text-label-md text-on-surface transition-colors hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isLookingUp || zip.replace(/\D/g, "").length !== 8}
            onClick={handleLookup}
            type="button"
          >
            {isLookingUp ? "Buscando…" : "Buscar endereço"}
          </button>
        ) : null}
      </div>

      {lookupNotice ? <p className="font-body text-body-sm text-on-surface-variant">{lookupNotice}</p> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <TextField
            defaultValue={fields.street}
            disabled={!canEdit}
            error={state.fieldErrors?.street}
            icon="signpost"
            id="street"
            key={`street-${lookupVersion}`}
            label="Logradouro"
            name="street"
            placeholder="Rua/Avenida"
            required={false}
          />
        </div>

        <TextField
          defaultValue={defaultValues.number}
          disabled={!canEdit}
          error={state.fieldErrors?.number}
          icon="tag"
          id="number"
          label="Número"
          name="number"
          required={false}
        />

        <TextField
          defaultValue={defaultValues.complement}
          disabled={!canEdit}
          error={state.fieldErrors?.complement}
          icon="apartment"
          id="complement"
          label="Complemento (opcional)"
          name="complement"
          required={false}
        />

        <TextField
          defaultValue={fields.neighborhood}
          disabled={!canEdit}
          error={state.fieldErrors?.neighborhood}
          icon="location_city"
          id="neighborhood"
          key={`neighborhood-${lookupVersion}`}
          label="Bairro"
          name="neighborhood"
          required={false}
        />

        <TextField
          defaultValue={fields.city}
          disabled={!canEdit}
          error={state.fieldErrors?.city}
          icon="location_on"
          id="city"
          key={`city-${lookupVersion}`}
          label="Cidade"
          name="city"
          required={false}
        />

        <div key={`state-${lookupVersion}`}>
          <label className="mb-2 block font-label text-label-sm text-on-surface-variant" htmlFor="state">
            Estado
          </label>
          <select
            className="w-full rounded-lg border border-outline-variant/50 bg-surface-container-lowest px-4 py-3 font-body text-body-md text-on-surface disabled:cursor-not-allowed disabled:opacity-60"
            defaultValue={fields.state}
            disabled={!canEdit}
            id="state"
            name="state"
          >
            <option value="">Selecione…</option>
            {BRAZILIAN_STATES.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </select>
          {state.fieldErrors?.state ? <p className="mt-1 font-body text-body-sm text-error">{state.fieldErrors.state}</p> : null}
        </div>
      </div>

      {state.status === "error" && state.message ? (
        <p className="rounded-lg border border-error/30 bg-error-container/10 px-3 py-2 font-body text-body-sm text-error" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.status === "success" ? <p className="font-body text-body-sm text-emerald-400">{state.message}</p> : null}

      {canEdit ? (
        <div>
          <SaveButton />
        </div>
      ) : null}
    </form>
  );
}
