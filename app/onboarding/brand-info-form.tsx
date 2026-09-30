"use client";

import { useActionState } from "react";

import { OnboardingFormActions } from "@/components/onboarding/onboarding-form-actions";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { TextareaField } from "@/components/ui/textarea-field";
import { saveBrandInfoAction } from "@/features/onboarding/actions";
import { initialBrandInfoState } from "@/features/onboarding/schema";
import { SEGMENT_OPTIONS } from "@/features/settings/segments";

interface DefaultValues {
  storeName: string;
  segment: string;
  description: string;
  instagram: string;
  whatsapp: string;
  email: string;
}

export function BrandInfoForm({ defaultValues, allowSkip }: { defaultValues: DefaultValues; allowSkip: boolean }) {
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

      <OnboardingFormActions allowSkip={allowSkip} nextHref="/onboarding/revisar" stepKey="seu-negocio" />
    </form>
  );
}
