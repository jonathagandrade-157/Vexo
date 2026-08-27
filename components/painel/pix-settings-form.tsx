"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { TextField } from "@/components/ui/text-field";
import { updatePixSettingsAction } from "@/features/settings/pix-actions";
import { initialPixSettingsState, PIX_KEY_TYPE_LABELS, PIX_KEY_TYPES, type PixKeyType } from "@/features/settings/pix-schema";

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

/** Liga/desliga o PIX direto — mesmo padrão visual do toggle de entrega (`ShippingSettingsForm`), mas aqui é só um `<input type="checkbox">` dentro do próprio form (não precisa de uma Action separada — salva junto com o resto). */
function EnabledToggle({ enabled, onToggle, canEdit }: { enabled: boolean; onToggle: (next: boolean) => void; canEdit: boolean }) {
  return (
    <label
      className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
        enabled ? "border-primary/40 bg-primary/10" : "border-outline-variant/50 bg-surface-container-lowest"
      } ${!canEdit ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
    >
      <input checked={enabled} className="sr-only" disabled={!canEdit} name="enabled" onChange={(e) => onToggle(e.target.checked)} type="checkbox" />
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? "bg-primary" : "bg-surface-container-highest"}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`}
        />
      </span>
      <span className="flex flex-col">
        <span className="font-label text-label-md text-on-surface">
          {enabled ? "PIX direto habilitado" : "PIX direto desabilitado"}
        </span>
        <span className="font-body text-body-sm text-on-surface-variant">Permitir pagamento via PIX sem gateway</span>
      </span>
    </label>
  );
}

/**
 * Fase D2-B (revisão final). "💠 PIX direto" — configuração 1:1 do
 * tenant (tenants.pix_*, migration 20260817220083). A chave nunca é
 * validada como "existente" de verdade (a VEXO não confirma pagamentos
 * feitos diretamente nela) — só o formato é checado, e o aviso abaixo
 * deixa isso explícito para o lojista.
 */
export function PixSettingsForm({
  canEdit,
  initialEnabled,
  initialKeyType,
  initialKey,
  initialRecipientName,
}: {
  canEdit: boolean;
  initialEnabled: boolean;
  initialKeyType: PixKeyType | null;
  initialKey: string;
  initialRecipientName: string;
}) {
  const [state, formAction] = useActionState(updatePixSettingsAction, initialPixSettingsState);
  const [enabled, setEnabled] = useState(initialEnabled);

  return (
    <form action={formAction} className="flex flex-col gap-5 rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
      <div>
        <h2 className="font-headline text-headline-sm text-on-surface">💠 PIX direto</h2>
        <p className="mt-1 font-body text-body-sm text-on-surface-variant">
          Permita que clientes paguem diretamente na sua chave PIX, sem gateway — usado no fluxo de pedidos pelo WhatsApp.
        </p>
      </div>

      <EnabledToggle canEdit={canEdit} enabled={enabled} onToggle={setEnabled} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-2 block font-label text-label-sm text-on-surface-variant" htmlFor="pixKeyType">
            Tipo da chave
          </label>
          <select
            className="w-full rounded-lg border border-outline-variant/50 bg-surface-container-lowest px-4 py-3 font-body text-body-md text-on-surface disabled:cursor-not-allowed disabled:opacity-60"
            defaultValue={initialKeyType ?? ""}
            disabled={!canEdit}
            id="pixKeyType"
            name="pixKeyType"
          >
            <option value="">Selecione…</option>
            {PIX_KEY_TYPES.map((type) => (
              <option key={type} value={type}>
                {PIX_KEY_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          {state.fieldErrors?.pixKeyType ? (
            <p className="mt-1 font-body text-body-sm text-error">{state.fieldErrors.pixKeyType}</p>
          ) : null}
        </div>

        <TextField
          defaultValue={initialKey}
          disabled={!canEdit}
          error={state.fieldErrors?.pixKey}
          icon="key"
          id="pixKey"
          label="Chave PIX"
          name="pixKey"
          placeholder="CPF, e-mail, telefone ou chave aleatória"
        />

        <div className="sm:col-span-2">
          <TextField
            defaultValue={initialRecipientName}
            disabled={!canEdit}
            error={state.fieldErrors?.recipientName}
            icon="badge"
            id="recipientName"
            label="Nome do recebedor"
            name="recipientName"
            placeholder="Nome que aparece para o cliente conferir"
          />
        </div>
      </div>

      <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 font-body text-body-sm text-amber-200">
        Confira cuidadosamente sua chave PIX antes de salvar. A VEXO não confirma automaticamente pagamentos realizados
        diretamente nessa chave.
      </p>

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
