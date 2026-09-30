"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFormStatus } from "react-dom";

import { skipOnboardingStepAction } from "@/features/onboarding/actions";

/** Ações de um formulário do onboarding que pode ser concluído depois. */
export function OnboardingFormActions({
  stepKey,
  nextHref,
  allowSkip,
}: {
  stepKey: string;
  nextHref: string;
  allowSkip: boolean;
}) {
  const router = useRouter();
  const { pending: formPending } = useFormStatus();
  const [skipPending, setSkipPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = formPending || skipPending;

  async function handleSkip() {
    setSkipPending(true);
    setError(null);
    const result = await skipOnboardingStepAction(stepKey);
    if (result.status === "error") {
      setError(result.message ?? "Não foi possível pular esta etapa. Tente novamente.");
      setSkipPending(false);
      return;
    }
    router.push(nextHref);
  }

  return (
    <div className="mt-2 flex flex-col gap-3 border-t border-outline-variant/20 pt-6">
      {error ? (
        <p className="rounded-lg border border-error/30 bg-error-container/10 px-4 py-2 text-body-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col-reverse justify-end gap-3 sm:flex-row sm:items-center">
        {allowSkip ? (
          <button
            className="rounded-lg px-6 py-3 font-label text-label-md text-on-surface-variant transition-[transform,color] duration-150 hover:text-on-surface active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={pending}
            onClick={handleSkip}
            type="button"
          >
            {skipPending ? "Pulando…" : "Pular por enquanto"}
          </button>
        ) : null}
        <button
          className="flex items-center justify-center gap-2 rounded-lg bg-primary-container px-6 py-3 font-label text-label-md text-on-primary-container transition-[transform,background-color] duration-150 hover:bg-[#8B5CF6] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {formPending ? "Salvando…" : "Salvar e continuar"}
          {formPending ? null : <span className="material-symbols-outlined text-[18px]">arrow_forward</span>}
        </button>
      </div>
    </div>
  );
}
