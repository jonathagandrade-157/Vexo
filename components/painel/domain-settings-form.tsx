"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { DomainVerificationCard } from "@/components/painel/domain-verification-card";
import { TextField } from "@/components/ui/text-field";
import { addCustomDomainAction, type TenantDomainRow } from "@/features/settings/domain-actions";
import { initialDomainActionState } from "@/features/settings/domain-schema";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className="rounded-lg bg-primary-container px-5 py-2.5 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? "Cadastrando…" : "Cadastrar domínio"}
    </button>
  );
}

/**
 * D17.2 — cadastro de domínio personalizado, sempre `pending`. D17.3.3
 * evolui cada item da lista (`DomainVerificationCard`) para o fluxo
 * completo de verificação DNS TXT (D17.3.2) — este componente continua
 * responsável só pelo cadastro (form + lista), nunca pela lógica de
 * verificação em si.
 */
export function DomainSettingsForm({ canEdit, domains }: { canEdit: boolean; domains: TenantDomainRow[] }) {
  const [state, formAction] = useActionState(addCustomDomainAction, initialDomainActionState);

  return (
    <div className="flex flex-col gap-5 rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
      <div>
        <h2 className="font-headline text-headline-sm text-on-surface">Domínio personalizado</h2>
        <p className="mt-1 font-body text-body-sm text-on-surface-variant">
          Cadastre um domínio próprio para sua loja. Depois de cadastrado, ele fica pendente de verificação — ainda não
          substitui o endereço padrão da sua loja.
        </p>
      </div>

      {domains.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {domains.map((d) => (
            <DomainVerificationCard canEdit={canEdit} domain={d} key={d.id} />
          ))}
        </ul>
      ) : (
        <p className="font-body text-body-sm text-on-surface-variant">Nenhum domínio cadastrado ainda.</p>
      )}

      {canEdit ? (
        <form action={formAction} className="flex flex-col gap-4">
          <TextField
            error={state.fieldErrors?.domain}
            icon="language"
            id="domain"
            label="Novo domínio"
            name="domain"
            placeholder="www.minhaloja.com.br"
            type="text"
          />

          {state.status === "error" && state.message ? (
            <p className="rounded-lg border border-error/30 bg-error-container/10 px-3 py-2 font-body text-body-sm text-error" role="alert">
              {state.message}
            </p>
          ) : null}
          {state.status === "success" ? <p className="font-body text-body-sm text-emerald-400">{state.message}</p> : null}

          <div>
            <SaveButton />
          </div>
        </form>
      ) : null}
    </div>
  );
}
