"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { TextField } from "@/components/ui/text-field";
import { initialWhatsappSettingsState } from "@/features/settings/whatsapp-schema";
import { updateWhatsappSettingsAction } from "@/features/settings/whatsapp-actions";
import { buildWhatsappLink } from "@/lib/whatsapp/link";
import { normalizeBrazilianPhone } from "@/lib/whatsapp/phone";

const TEST_MESSAGE = "Olá! Esta é uma mensagem de teste da configuração de WhatsApp para pedidos da sua loja na VEXO.";

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

/**
 * Fase D2-B.1 — única tela onde `tenants.whatsapp_phone` é editado (saiu
 * de "Minha Loja"/`store-profile-form.tsx`, Etapa 5, para nunca haver
 * dois formulários gravando a mesma coluna). O link exibido aqui é
 * puramente informativo — calculado no cliente só para preview
 * (`normalizeBrazilianPhone`/`buildWhatsappLink`, os mesmos dois helpers
 * que `features/checkout/whatsapp-link.ts` usa no servidor para montar o
 * link real do pedido, nunca uma segunda implementação) — quem decide o
 * valor de verdade continua sendo o servidor, na Action, no momento de
 * salvar.
 */
export function WhatsappSettingsForm({ canEdit, initialWhatsappPhone }: { canEdit: boolean; initialWhatsappPhone: string }) {
  const [state, formAction] = useActionState(updateWhatsappSettingsAction, initialWhatsappSettingsState);
  const [phoneInput, setPhoneInput] = useState(initialWhatsappPhone);

  const normalized = normalizeBrazilianPhone(phoneInput);
  const testLink = normalized ? buildWhatsappLink(normalized, TEST_MESSAGE) : null;

  return (
    <form action={formAction} className="flex flex-col gap-5 rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
      <div>
        <h2 className="font-headline text-headline-sm text-on-surface">WhatsApp para pedidos</h2>
        <p className="mt-1 font-body text-body-sm text-on-surface-variant">
          Configure o WhatsApp que receberá os pedidos realizados pela loja.
        </p>
      </div>

      <TextField
        defaultValue={initialWhatsappPhone}
        disabled={!canEdit}
        error={state.fieldErrors?.whatsappPhone}
        icon="call"
        id="whatsappPhone"
        label="Número do WhatsApp"
        name="whatsappPhone"
        onChange={setPhoneInput}
        placeholder="(11) 99999-9999"
        type="tel"
      />

      {testLink ? (
        <div className="flex flex-col gap-2 rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-4">
          <p className="font-body text-body-sm text-on-surface-variant">Link gerado automaticamente</p>
          <p className="break-all font-label text-label-md text-on-surface">wa.me/{normalized}</p>
          <a
            className="flex w-fit items-center gap-2 rounded-lg border border-outline-variant/50 px-4 py-2 font-label text-label-md text-on-surface transition-colors hover:border-primary/50"
            href={testLink}
            rel="noopener noreferrer"
            target="_blank"
          >
            <span className="material-symbols-outlined text-[18px]">chat</span>
            Testar WhatsApp
          </a>
        </div>
      ) : phoneInput.trim().length > 0 ? (
        <p className="font-body text-body-sm text-on-surface-variant">
          Informe um número válido para gerar o link automaticamente.
        </p>
      ) : null}

      <p className="font-body text-body-sm text-on-surface-variant">
        Este é o número que os clientes usarão para enviar pedidos e comprovantes pelo WhatsApp.
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
