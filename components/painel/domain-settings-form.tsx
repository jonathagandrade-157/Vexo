"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { TextField } from "@/components/ui/text-field";
import { addCustomDomainAction, type TenantDomainRow } from "@/features/settings/domain-actions";
import { initialDomainActionState } from "@/features/settings/domain-schema";

const STATUS_LABELS: Record<TenantDomainRow["status"], string> = {
  pending: "Pendente de verificação",
  verifying: "Verificando",
  active: "Ativo",
};

const STATUS_STYLES: Record<TenantDomainRow["status"], string> = {
  pending: "bg-surface-container-highest text-on-surface-variant",
  verifying: "bg-amber-500/10 text-amber-400",
  active: "bg-emerald-500/10 text-emerald-400",
};

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
 * D17.2 — cadastro de domínio personalizado, sempre `pending` (D17.3
 * implementa a verificação real, fora do escopo aqui). Mesmo padrão
 * visual de WhatsappSettingsForm (form + TextField + mensagens de
 * erro/sucesso). Só cadastro (ADD) — sem editar/remover/promover a
 * primário nesta etapa, não pedido no escopo.
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
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-3"
            >
              <span className="break-all font-label text-label-md text-on-surface">
                {d.domain}
                {d.isPrimary ? <span className="ml-2 font-body text-body-sm text-on-surface-variant">(primário)</span> : null}
              </span>
              <span className={`inline-flex items-center rounded-full px-2 py-1 font-label text-label-sm uppercase ${STATUS_STYLES[d.status]}`}>
                {STATUS_LABELS[d.status]}
              </span>
            </li>
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
