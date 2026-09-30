"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { completeOnboardingStepAction, skipOnboardingStepAction } from "@/features/onboarding/actions";

/**
 * D12.2 — botão "Continuar" da revisão, que funciona mesmo com a loja
 * vazia. O fluxo atual só mantém etapas que executam uma ação real. "publicar"
 * usa seu próprio botão (texto final diferente + redireciona para
 * /painel em vez da próxima etapa) — ver `publicar-step-content.tsx`.
 *
 * Chama `completeOnboardingStepAction` diretamente (não é dispatch de
 * `<form>`) e só então navega para `nextHref` — nunca navega antes de o
 * servidor confirmar que a etapa foi de fato marcada (evita o cliente
 * "achar" que avançou quando a Server Action rejeitou por algum motivo,
 * ex. etapa ainda não alcançável por uma segunda aba estar fora de
 * sincronia).
 */
export function OnboardingContinueButton({
  stepKey,
  nextHref,
  label = "Continuar",
  allowSkip = false,
}: {
  stepKey: string;
  nextHref: string;
  label?: string;
  allowSkip?: boolean;
}) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<"continue" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    setPendingAction("continue");
    setError(null);
    const result = await completeOnboardingStepAction(stepKey);
    if (result.status === "error") {
      setError(result.message ?? "Não foi possível confirmar esta etapa. Tente novamente.");
      setPendingAction(null);
      return;
    }
    router.push(nextHref);
  }

  async function handleSkip() {
    setPendingAction("skip");
    setError(null);
    const result = await skipOnboardingStepAction(stepKey);
    if (result.status === "error") {
      setError(result.message ?? "Não foi possível pular esta etapa. Tente novamente.");
      setPendingAction(null);
      return;
    }
    router.push(nextHref);
  }

  const pending = pendingAction !== null;

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p className="rounded-lg border border-error/30 bg-error-container/10 px-4 py-2 text-body-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col-reverse justify-end gap-3 border-t border-outline-variant/20 pt-6 sm:flex-row sm:items-center">
        {allowSkip ? (
          <button
            className="rounded-lg px-6 py-3 font-label text-label-md text-on-surface-variant transition-[transform,color] duration-150 hover:text-on-surface active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={pending}
            onClick={handleSkip}
            type="button"
          >
            {pendingAction === "skip" ? "Pulando…" : "Pular por enquanto"}
          </button>
        ) : null}
        <button
          className="flex items-center gap-2 rounded-lg bg-primary-container px-6 py-3 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pending}
          onClick={handleContinue}
          type="button"
        >
          {pendingAction === "continue" ? "Salvando…" : label}
          {pendingAction === "continue" ? null : <span className="material-symbols-outlined text-[18px]">arrow_forward</span>}
        </button>
      </div>
    </div>
  );
}
