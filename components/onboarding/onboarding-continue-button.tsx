"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { completeOnboardingStepAction } from "@/features/onboarding/actions";

/**
 * D12.2 — botão "Continuar" para etapas SEM opção de pular (hoje só
 * "revisar" — nada para pular numa tela de revisão, ela funciona mesmo
 * vazia). Etapas `skippable` (identidade/produtos/categorias/pagamentos/
 * entrega) usam `OnboardingStepActions` (D12.2.1), que renderiza este
 * mesmo botão de "Continuar" ao lado de "Pular por enquanto". "publicar"
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
}: {
  stepKey: string;
  nextHref: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    setPending(true);
    setError(null);
    const result = await completeOnboardingStepAction(stepKey);
    if (result.status === "error") {
      setError(result.message ?? "Não foi possível confirmar esta etapa. Tente novamente.");
      setPending(false);
      return;
    }
    router.push(nextHref);
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p className="rounded-lg border border-error/30 bg-error-container/10 px-4 py-2 text-body-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end border-t border-outline-variant/20 pt-6">
        <button
          className="flex items-center gap-2 rounded-lg bg-primary-container px-6 py-3 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pending}
          onClick={handleContinue}
          type="button"
        >
          {pending ? "Salvando…" : label}
          {pending ? null : <span className="material-symbols-outlined text-[18px]">arrow_forward</span>}
        </button>
      </div>
    </div>
  );
}
