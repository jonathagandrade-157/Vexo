"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { TextareaField } from "@/components/ui/textarea-field";
import { saveBrandInfoAction } from "@/features/onboarding/actions";
import { initialBrandInfoState } from "@/features/onboarding/schema";
import type { BusinessType } from "@/features/onboarding/step-definitions";
import { SEGMENT_OPTIONS } from "@/features/settings/segments";

interface DefaultValues {
  storeName: string;
  businessType: BusinessType | null;
  segment: string;
  description: string;
  instagram: string;
  whatsapp: string;
  email: string;
}

/**
 * D12.2 — só `ecommerce` tem wizard implementado nesta etapa
 * (`features/onboarding/step-definitions.ts`, ONBOARDING_STEPS).
 * restaurant/adega aparecem aqui (mesmos 3 valores da coluna,
 * migration 20260817220093) mas desabilitados/"Em breve" — comunica a
 * visão multi-segmento (D12.1) sem oferecer uma opção que hoje deixaria
 * o tenant sem nenhuma etapa seguinte.
 */
const BUSINESS_TYPE_CHOICES: { value: BusinessType; label: string; icon: string; enabled: boolean }[] = [
  { value: "ecommerce", label: "Loja virtual", icon: "storefront", enabled: true },
  { value: "restaurant", label: "Restaurante", icon: "restaurant", enabled: false },
  { value: "adega", label: "Adega", icon: "wine_bar", enabled: false },
];

function BusinessTypeField({
  value,
  onChange,
  error,
}: {
  value: BusinessType | null;
  onChange: (value: BusinessType) => void;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-label text-label-md uppercase text-on-surface-variant">Tipo do negócio</span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {BUSINESS_TYPE_CHOICES.map((choice) => (
          <button
            className={
              value === choice.value
                ? "flex flex-col items-center gap-2 rounded-lg border-2 border-primary bg-primary-container/10 px-4 py-4 font-label text-label-sm text-on-surface transition-colors"
                : choice.enabled
                  ? "flex flex-col items-center gap-2 rounded-lg border border-surface-container-highest px-4 py-4 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary/50 hover:text-on-surface"
                  : "flex cursor-not-allowed flex-col items-center gap-2 rounded-lg border border-surface-container-highest px-4 py-4 font-label text-label-sm text-on-surface-variant opacity-50"
            }
            disabled={!choice.enabled}
            key={choice.value}
            onClick={() => onChange(choice.value)}
            type="button"
          >
            <span className="material-symbols-outlined text-2xl">{choice.icon}</span>
            {choice.label}
            {!choice.enabled ? <span className="text-[10px] uppercase tracking-wider">Em breve</span> : null}
          </button>
        ))}
      </div>
      {/* Campo real enviado no FormData — os botões acima só controlam este valor, nunca substituem a validação Zod do lado do servidor. */}
      <input name="businessType" type="hidden" value={value ?? ""} />
      {error ? (
        <p className="text-label-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
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
  // D12.2 — só 'ecommerce' é selecionável hoje (BUSINESS_TYPE_CHOICES
  // acima), então já parte selecionado por padrão em vez de forçar um
  // clique extra num formulário onde só há uma escolha real possível.
  const [businessType, setBusinessType] = useState<BusinessType | null>(defaultValues.businessType ?? "ecommerce");

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
      <BusinessTypeField error={state.fieldErrors?.businessType} onChange={setBusinessType} value={businessType} />
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
