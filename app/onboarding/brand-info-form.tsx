"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { TextareaField } from "@/components/ui/textarea-field";
import { initialBrandInfoState, saveBrandInfoAction } from "@/features/onboarding/actions";

const SEGMENT_OPTIONS = [
  { value: "apparel", label: "Moda & Vestuário" },
  { value: "electronics", label: "Eletrônicos" },
  { value: "beauty", label: "Beleza & Cosméticos" },
  { value: "home", label: "Casa & Decoração" },
  { value: "other", label: "Outros" },
];

interface DefaultValues {
  storeName: string;
  segment: string;
  description: string;
  instagram: string;
  whatsapp: string;
  email: string;
}

function ContinueButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className="flex items-center gap-2 rounded-lg bg-primary-container px-6 py-3 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? "Salvando…" : "Continuar"}
      {pending ? null : <span className="material-symbols-outlined text-[18px]">arrow_forward</span>}
    </button>
  );
}

export function BrandInfoForm({ defaultValues }: { defaultValues: DefaultValues }) {
  const [state, formAction] = useActionState(saveBrandInfoAction, initialBrandInfoState);

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <TextField
        id="storeName"
        name="storeName"
        label="Nome da loja"
        icon="storefront"
        placeholder="Ex: Vexo Store"
        error={state.fieldErrors?.storeName}
        defaultValue={defaultValues.storeName}
      />
      <SelectField
        id="segment"
        name="segment"
        label="Segmento"
        placeholder="Selecione um segmento"
        options={SEGMENT_OPTIONS}
        error={state.fieldErrors?.segment}
        defaultValue={defaultValues.segment}
      />
      <TextareaField
        id="description"
        name="description"
        label="Descrição da marca (opcional)"
        placeholder="O que sua marca representa? Quais são seus diferenciais?"
        error={state.fieldErrors?.description}
        defaultValue={defaultValues.description}
      />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <TextField
          id="instagram"
          name="instagram"
          label="Instagram"
          icon="alternate_email"
          placeholder="suamarca"
          error={state.fieldErrors?.instagram}
          defaultValue={defaultValues.instagram}
        />
        <TextField
          id="whatsapp"
          name="whatsapp"
          label="WhatsApp"
          icon="call"
          type="tel"
          placeholder="(00) 00000-0000"
          error={state.fieldErrors?.whatsapp}
          defaultValue={defaultValues.whatsapp}
        />
      </div>
      <TextField
        id="email"
        name="email"
        label="E-mail comercial"
        icon="mail"
        type="email"
        placeholder="contato@suamarca.com.br"
        error={state.fieldErrors?.email}
        defaultValue={defaultValues.email}
      />

      {state.status === "error" && state.message ? (
        <p className="rounded-lg border border-error/30 bg-error-container/10 px-4 py-2 text-body-sm text-error" role="alert">
          {state.message}
        </p>
      ) : null}

      <div className="mt-2 flex justify-end border-t border-outline-variant/20 pt-6">
        <ContinueButton />
      </div>
    </form>
  );
}
