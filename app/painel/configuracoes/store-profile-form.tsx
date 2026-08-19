"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { LogoutButton } from "@/components/painel/logout-button";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { TextareaField } from "@/components/ui/textarea-field";
import { initialStoreProfileState, updateStoreProfileAction } from "@/features/settings/actions";
import { SEGMENT_OPTIONS } from "@/features/settings/segments";

interface DefaultValues {
  storeName: string;
  segment: string;
  description: string;
  instagram: string;
  whatsapp: string;
  email: string;
}

function SaveButton({ canEdit }: { canEdit: boolean }) {
  const { pending } = useFormStatus();
  if (!canEdit) return null;
  return (
    <button
      className="rounded-lg bg-primary-container px-6 py-3 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? "Salvando…" : "Salvar alterações"}
    </button>
  );
}

export function StoreProfileForm({
  canEdit,
  defaultValues,
}: {
  canEdit: boolean;
  defaultValues: DefaultValues;
}) {
  const [state, formAction] = useActionState(updateStoreProfileAction, initialStoreProfileState);

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <div className="rounded-xl border border-surface-container-highest bg-[#121212] p-6">
        <div className="mb-6 flex items-center justify-between border-b border-surface-container-highest pb-4">
          <h2 className="font-headline text-headline-sm text-on-surface">Minha Loja</h2>
          {!canEdit ? (
            <span className="rounded bg-surface-container-high px-2 py-1 font-label text-label-sm text-on-surface-variant">
              Somente leitura
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          <TextField
            defaultValue={defaultValues.storeName}
            disabled={!canEdit}
            error={state.fieldErrors?.storeName}
            icon="storefront"
            id="storeName"
            label="Nome da loja"
            name="storeName"
          />
          <SelectField
            defaultValue={defaultValues.segment}
            disabled={!canEdit}
            error={state.fieldErrors?.segment}
            id="segment"
            label="Segmento"
            name="segment"
            options={SEGMENT_OPTIONS}
            placeholder="Selecione um segmento"
          />
          <TextareaField
            defaultValue={defaultValues.description}
            disabled={!canEdit}
            error={state.fieldErrors?.description}
            id="description"
            label="Descrição da marca (opcional)"
            name="description"
          />
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <TextField
              defaultValue={defaultValues.instagram}
              disabled={!canEdit}
              error={state.fieldErrors?.instagram}
              icon="alternate_email"
              id="instagram"
              label="Instagram"
              name="instagram"
            />
            <TextField
              defaultValue={defaultValues.whatsapp}
              disabled={!canEdit}
              error={state.fieldErrors?.whatsapp}
              icon="call"
              id="whatsapp"
              label="WhatsApp"
              name="whatsapp"
              type="tel"
            />
          </div>
          <TextField
            defaultValue={defaultValues.email}
            disabled={!canEdit}
            error={state.fieldErrors?.email}
            icon="mail"
            id="email"
            label="E-mail comercial"
            name="email"
            type="email"
          />
        </div>
      </div>

      {state.status === "error" && state.message ? (
        <p className="rounded-lg border border-error/30 bg-error-container/10 px-4 py-2 text-body-sm text-error" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.status === "success" && state.message ? (
        <p className="rounded-lg border border-[#10B981]/30 bg-[#10B981]/10 px-4 py-2 text-body-sm text-[#10B981]" role="status">
          {state.message}
        </p>
      ) : null}

      <div className="flex items-center justify-between">
        <SaveButton canEdit={canEdit} />
        <div className="ml-auto w-full max-w-[220px] md:hidden">
          <LogoutButton variant="settings" />
        </div>
      </div>
    </form>
  );
}
