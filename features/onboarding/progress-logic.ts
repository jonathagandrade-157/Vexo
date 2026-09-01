import type { OnboardingStepDefinition } from "./step-definitions";

/**
 * D12.2/D12.2.1 — toda a lógica de "que etapa é essa, o que já foi
 * respondido, o que vem a seguir, dá para acessar esta etapa agora" vive
 * aqui como funções puras (sem `supabase`, sem `fetch`, sem React) —
 * testável sem banco, sem Server Component, sem infraestrutura nenhuma
 * (prompt D12.2: "evitar colocar toda essa lógica dentro de componentes
 * React"). Só consome a definição estática de steps (`step-definitions.ts`)
 * + o progresso já carregado do banco (`StepProgressEntry[]`, forma
 * mínima — quem carrega do Postgres é `progress.ts`, "server-only").
 */

export type StepProgressStatus = "completed" | "skipped";

export interface StepProgressEntry {
  stepKey: string;
  /** `null` = etapa ainda não respondida (pending). Nunca inferido de outra tabela — sempre a ação explícita do lojista (D12.2.1). */
  status: StepProgressStatus | null;
  /** Quando a etapa foi resolvida (completed OU skipped) — `null` enquanto `status` for `null`. */
  completedAt: string | null;
}

/**
 * D12.2.1 — "resolvida" (completed OU skipped) é o que basta para
 * alcançabilidade/retomada; "concluída de fato" (completed) é o que uma
 * etapa não-`skippable` (seu-negocio/revisar/publicar) precisa
 * especificamente. As duas funções abaixo nunca se confundem: "skipped"
 * satisfaz progresso, nunca significa "a feature foi configurada".
 */
function resolvedStepKeys(progress: readonly StepProgressEntry[]): Set<string> {
  return new Set(progress.filter((p) => p.status !== null).map((p) => p.stepKey));
}

function completedStepKeys(progress: readonly StepProgressEntry[]): Set<string> {
  return new Set(progress.filter((p) => p.status === "completed").map((p) => p.stepKey));
}

/** Uma etapa é considerada "satisfeita" para fins de conclusão/alcançabilidade: `skippable` aceita completed OU skipped; não-`skippable` exige `completed`. */
function isStepSatisfied(step: OnboardingStepDefinition, resolved: Set<string>, completed: Set<string>): boolean {
  return step.skippable ? resolved.has(step.key) : completed.has(step.key);
}

/** `-1` (não `undefined`) quando a key não pertence a esta definição — mesmo contrato de `Array.prototype.findIndex`, comparado por identidade em todo o resto do arquivo. */
function stepIndex(steps: readonly OnboardingStepDefinition[], stepKey: string): number {
  return steps.findIndex((s) => s.key === stepKey);
}

/**
 * Uma etapa é alcançável quando toda etapa `required` ANTES dela (na
 * ordem da definição) já está satisfeita (completed, ou skipped se
 * `skippable`) — nunca quando a etapa em si já está resolvida (revisitar
 * uma etapa concluída OU pulada é sempre permitido, essa checagem é só
 * sobre o que vem antes). `stepKey` fora da definição (nunca pertenceu a
 * este `business_type`, ou é lixo vindo de um cliente malicioso) é sempre
 * inalcançável — é essa checagem que fecha "acesso direto a
 * /onboarding/publicar sem ter concluído as etapas anteriores" e
 * "stepKey não pertence ao business_type atual" (D12.2, seção SEGURANÇA
 * DE ROTAS).
 */
export function isStepReachable(
  steps: readonly OnboardingStepDefinition[],
  progress: readonly StepProgressEntry[],
  stepKey: string,
): boolean {
  const index = stepIndex(steps, stepKey);
  if (index === -1) return false;

  const resolved = resolvedStepKeys(progress);
  const completed = completedStepKeys(progress);
  for (let i = 0; i < index; i++) {
    const step = steps[i]!;
    if (step.required && !isStepSatisfied(step, resolved, completed)) return false;
  }
  return true;
}

/**
 * A etapa "atual" é sempre a primeira `required` ainda não satisfeita
 * (nem completed, nem skipped quando `skippable`) — serve tanto para
 * resolver a etapa inicial (progresso vazio → primeira etapa da
 * definição) quanto para retomada (progresso parcial → primeira lacuna),
 * o mesmo cálculo em ambos os casos (D12.2 pede as duas coisas
 * separadamente, mas são o mesmo resultado por construção: BANCO é a
 * única fonte, nunca client state, então "primeira etapa" nada mais é
 * que "retomada com zero progresso salvo"). Uma etapa `skipped` NUNCA é
 * "a atual" de novo — pular avança, exatamente como concluir (D12.2.1).
 * `null` só quando a definição está vazia (business_type sem wizard
 * implementado ainda). Quando toda `required` já está satisfeita, cai na
 * última etapa da definição — nesse ponto `isOnboardingComplete` abaixo
 * já é `true` e quem chama (`app/onboarding/page.tsx`) redireciona para
 * `/painel` antes de renderizar qualquer etapa.
 */
export function resolveCurrentStepKey(
  steps: readonly OnboardingStepDefinition[],
  progress: readonly StepProgressEntry[],
): string | null {
  if (steps.length === 0) return null;

  const resolved = resolvedStepKeys(progress);
  const completed = completedStepKeys(progress);
  const firstUnsatisfiedRequired = steps.find((s) => s.required && !isStepSatisfied(s, resolved, completed));
  if (firstUnsatisfiedRequired) return firstUnsatisfiedRequired.key;

  return steps[steps.length - 1]!.key;
}

/** `null` quando não há próxima etapa (última da definição) ou `stepKey` é desconhecido. */
export function resolveNextStepKey(steps: readonly OnboardingStepDefinition[], stepKey: string): string | null {
  const index = stepIndex(steps, stepKey);
  if (index === -1 || index >= steps.length - 1) return null;
  return steps[index + 1]!.key;
}

/** `null` quando é a primeira etapa (nada para "Voltar") ou `stepKey` é desconhecido. */
export function resolvePreviousStepKey(steps: readonly OnboardingStepDefinition[], stepKey: string): string | null {
  const index = stepIndex(steps, stepKey);
  if (index <= 0) return null;
  return steps[index - 1]!.key;
}

/**
 * D12.2.1 — todas as etapas `required` da definição estão satisfeitas:
 * "seu-negocio" (e qualquer outra etapa não-`skippable`, como
 * "revisar"/"publicar") precisa estar especificamente `completed`; as
 * demais (`skippable: true`) aceitam `completed` OU `skipped`. `false`
 * (nunca `true` por omissão) quando a definição está vazia — um
 * `business_type` sem wizard implementado nunca é considerado
 * "concluído" por este cálculo.
 */
export function isOnboardingComplete(
  steps: readonly OnboardingStepDefinition[],
  progress: readonly StepProgressEntry[],
): boolean {
  const requiredSteps = steps.filter((s) => s.required);
  if (requiredSteps.length === 0) return false;
  const resolved = resolvedStepKeys(progress);
  const completed = completedStepKeys(progress);
  return requiredSteps.every((s) => isStepSatisfied(s, resolved, completed));
}

export interface StepPosition {
  stepNumber: number;
  totalSteps: number;
  percentage: number;
}

/**
 * Posição de UMA etapa específica dentro da definição — diferente de
 * `calculateOnboardingProgress`, que descreve a etapa "atual" (primeira
 * `required` pendente). Usado quando o lojista revisita uma etapa já
 * concluída OU pulada (D12.2.1: "o usuário deve poder voltar
 * posteriormente às etapas skipped") — o número exibido ("Etapa X de Y")
 * precisa refletir a etapa que está sendo mostrada na tela, não a etapa
 * em que o progresso realmente está. `null` quando `stepKey` não
 * pertence à definição.
 */
export function describeStepPosition(steps: readonly OnboardingStepDefinition[], stepKey: string): StepPosition | null {
  const index = stepIndex(steps, stepKey);
  if (index === -1) return null;
  const totalSteps = steps.length;
  const stepNumber = index + 1;
  return { stepNumber, totalSteps, percentage: Math.round((stepNumber / totalSteps) * 100) };
}

export interface OnboardingProgressSummary {
  totalSteps: number;
  /** 1-based — o "X" de "Etapa X de Y" (D12.2: nunca hardcoded). */
  currentStepNumber: number;
  currentStepKey: string | null;
  /** Etapas `required` já satisfeitas — completed OU (se skippable) skipped. Nunca confundir com "quantas foram de fato preenchidas". */
  resolvedRequiredCount: number;
  /** Subconjunto de `resolvedRequiredCount` que foi de fato `completed` (não pulado) — só para diagnóstico/telemetria futura, não usado por nenhum gate. */
  completedRequiredCount: number;
  totalRequiredCount: number;
  /** 0–100, arredondado — `currentStepNumber / totalSteps`, nunca uma constante. */
  percentage: number;
  isComplete: boolean;
}

/** Único ponto que a UI consulta para "Etapa X de Y" + barra de progresso — nunca calculado de novo em cada componente (prompt D12.2: "a lógica deve ser testável sem banco", "evitar colocar toda essa lógica dentro de componentes React"). */
export function calculateOnboardingProgress(
  steps: readonly OnboardingStepDefinition[],
  progress: readonly StepProgressEntry[],
): OnboardingProgressSummary {
  const totalSteps = steps.length;
  const requiredSteps = steps.filter((s) => s.required);
  const resolved = resolvedStepKeys(progress);
  const completed = completedStepKeys(progress);
  const resolvedRequiredCount = requiredSteps.filter((s) => isStepSatisfied(s, resolved, completed)).length;
  const completedRequiredCount = requiredSteps.filter((s) => completed.has(s.key)).length;
  const totalRequiredCount = requiredSteps.length;
  const complete = isOnboardingComplete(steps, progress);

  const currentStepKey = resolveCurrentStepKey(steps, progress);
  const currentIndex = currentStepKey ? stepIndex(steps, currentStepKey) : -1;
  const currentStepNumber = currentIndex === -1 ? totalSteps : currentIndex + 1;
  const percentage = totalSteps === 0 ? 0 : Math.round((currentStepNumber / totalSteps) * 100);

  return {
    totalSteps,
    currentStepNumber,
    currentStepKey,
    resolvedRequiredCount,
    completedRequiredCount,
    totalRequiredCount,
    percentage,
    isComplete: complete,
  };
}
