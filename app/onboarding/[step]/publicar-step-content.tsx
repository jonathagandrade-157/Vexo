"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { completeOnboardingStepAction } from "@/features/onboarding/actions";

/**
 * D12.2 — última etapa. Confirmar aqui é o que faz
 * `recomputeOnboardingCompletion` (chamado dentro de
 * `completeOnboardingStepAction`) encontrar todo step `required` já
 * concluído e finalmente gravar `tenants.onboarding_completed_at` — L1
 * (D12.1/D12.2): nenhum campo novo (`published_at`/`is_published`), a
 * publicação É o preenchimento desse campo, exatamente como já
 * acontecia antes desta etapa (D12.0), só que agora depois de 8 etapas
 * reais em vez de 1. `resolveStorefrontTenant`
 * (features/storefront/resolve-tenant.ts) continua sem alteração — ao
 * ficar preenchido, a loja passa a responder em `/loja/{slug}`
 * automaticamente, do mesmo jeito que já respondia antes desta etapa.
 */
export function PublicarStepContent() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);

  async function handlePublish() {
    setPending(true);
    setError(null);
    const result = await completeOnboardingStepAction("publicar");
    if (result.status === "error") {
      setError(result.message ?? "Não foi possível publicar sua loja. Tente novamente.");
      setPending(false);
      return;
    }
    setPublished(true);
    router.push("/painel");
  }

  if (published) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-[#10B981]/30 bg-[#10B981]/10 p-6 text-center">
        <span className="material-symbols-outlined text-4xl text-[#10B981]">check_circle</span>
        <p className="font-headline text-headline-sm text-on-surface">Loja publicada!</p>
        <p className="font-body text-body-sm text-on-surface-variant">Levando você para o painel…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <p className="rounded-lg border border-error/30 bg-error-container/10 px-4 py-2 text-body-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end border-t border-outline-variant/20 pt-6">
        <button
          className="flex items-center gap-2 rounded-lg bg-primary-container px-6 py-3 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pending}
          onClick={handlePublish}
          type="button"
        >
          <span className="material-symbols-outlined text-[18px]">rocket_launch</span>
          {pending ? "Publicando…" : "Publicar loja"}
        </button>
      </div>
    </div>
  );
}
