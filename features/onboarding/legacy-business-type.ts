import type { StepProgressEntry } from "./progress-logic";
import type { BusinessType } from "./step-definitions";

/**
 * D15.1.1 — tenants legados escolheram `business_type` dentro do antigo
 * formulário único "seu-negocio" (antes de "segmento" existir como etapa
 * própria), então nunca têm — e nunca vão ganhar retroativamente, sem uma
 * migration de backfill que este ticket explicitamente proíbe (regra 7) —
 * uma linha em `onboarding_progress` para `step_key = 'segmento'`. Sem
 * este ajuste, `resolveCurrentStepKey` (progress-logic.ts, inalterado)
 * enxergaria "segmento" como a primeira etapa `required` ainda pendente e
 * empurraria esses tenants de volta para ela, mesmo já tendo
 * `business_type` definido.
 *
 * Corrigido sintetizando, só em memória (nunca gravando nada), uma entrada
 * `"segmento": "completed"` sempre que `businessType` já está definido e
 * não existe linha real para essa key — o próprio dado em
 * `tenants.business_type` já É a prova de que essa escolha foi feita, o
 * mesmo raciocínio que `resolveOnboardingState`
 * (`features/onboarding/progress.ts`, único chamador) já aplica ao derivar
 * `businessType` da coluna em vez de uma linha de progresso. Uma linha real
 * (gravada por `saveBusinessTypeAction`, tenants novos) nunca é duplicada —
 * `.some(...)` já a encontra e pula a síntese.
 *
 * Função pura, sem `"server-only"`/Supabase/`next/headers` (mesmo
 * princípio de `progress-logic.ts`) — extraída num arquivo próprio só para
 * ficar testável em isolamento, já que `progress.ts` (onde esta lógica
 * viveria naturalmente) importa `next/headers` transitivamente.
 */
export function withLegacyBusinessTypeCompletion(
  businessType: BusinessType | null,
  progress: readonly StepProgressEntry[],
): StepProgressEntry[] {
  if (!businessType || progress.some((p) => p.stepKey === "segmento")) {
    return [...progress];
  }
  return [...progress, { stepKey: "segmento", status: "completed", completedAt: null }];
}
