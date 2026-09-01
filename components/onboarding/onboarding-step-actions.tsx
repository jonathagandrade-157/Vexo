"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { completeOnboardingStepAction, skipOnboardingStepAction } from "@/features/onboarding/actions";

/**
 * D12.2.1 — "Continuar" + "Pular por enquanto" lado a lado, para as 5
 * etapas `skippable` (identidade, produtos, categorias, pagamentos,
 * entrega). Os dois botões navegam para a MESMA `nextHref` — a diferença
 * inteira está em qual Server Action é chamada antes
 * (`completeOnboardingStepAction` grava `status: "completed"`,
 * `skipOnboardingStepAction` grava `status: "skipped"`); nenhum dos dois
 * navega antes do servidor confirmar (mesmo cuidado de
 * `OnboardingContinueButton`).
 */
export function OnboardingStepActions({
  stepKey,
  nextHref,
  continueLabel,
}: {
  stepKey: string;
  nextHref: string;
  continueLabel: string;
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
        <button
          className="rounded-lg px-6 py-3 font-label text-label-md text-on-surface-variant transition-colors hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pending}
          onClick={handleSkip}
          type="button"
        >
          {pendingAction === "skip" ? "Pulando…" : "Pular por enquanto"}
        </button>
        <button
          className="flex items-center justify-center gap-2 rounded-lg bg-primary-container px-6 py-3 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pending}
          onClick={handleContinue}
          type="button"
        >
          {pendingAction === "continue" ? "Salvando…" : continueLabel}
          {pendingAction === "continue" ? null : <span className="material-symbols-outlined text-[18px]">arrow_forward</span>}
        </button>
      </div>
    </div>
  );
}
