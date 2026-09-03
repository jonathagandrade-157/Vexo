import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { withLegacyBusinessTypeCompletion } from "./legacy-business-type";
import {
  calculateOnboardingProgress,
  isOnboardingComplete,
  isStepReachable,
  resolveCurrentStepKey,
  type OnboardingProgressSummary,
  type StepProgressEntry,
  type StepProgressStatus,
} from "./progress-logic";
import { getStepsForBusinessType, isBusinessType, type BusinessType, type OnboardingStepDefinition } from "./step-definitions";

export interface OnboardingState {
  tenantId: string;
  businessType: BusinessType | null;
  steps: readonly OnboardingStepDefinition[];
  progress: readonly StepProgressEntry[];
  summary: OnboardingProgressSummary;
}

interface ProgressRow {
  step_key: string;
  completed_at: string | null;
  status: string | null;
}

function isStepProgressStatus(value: unknown): value is StepProgressStatus {
  return value === "completed" || value === "skipped";
}

/**
 * D12.2 — único ponto que combina "qual business_type este tenant tem" +
 * "o que já está em onboarding_progress" num resultado pronto para a UI
 * (Server Component) e para as Server Actions de step usarem. Nunca
 * confia em nada vindo do cliente — `tenantId` sempre chega aqui já
 * resolvido pela sessão (mesmo princípio de `resolveOnboardingTenant`,
 * `features/onboarding/resolve-tenant.ts`), nunca de um parâmetro de
 * rota ou FormData.
 */
export async function resolveOnboardingState(supabase: SupabaseClient, tenantId: string): Promise<OnboardingState> {
  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("business_type")
    .eq("id", tenantId)
    .maybeSingle();

  const rawBusinessType = tenantRow?.business_type as string | null | undefined;
  const businessType = isBusinessType(rawBusinessType) ? rawBusinessType : null;
  const steps = getStepsForBusinessType(businessType);

  const { data: progressRows } = await supabase
    .from("onboarding_progress")
    .select("step_key, completed_at, status")
    .eq("tenant_id", tenantId);

  const rawProgress: StepProgressEntry[] = ((progressRows ?? []) as ProgressRow[]).map((row) => ({
    stepKey: row.step_key,
    status: isStepProgressStatus(row.status) ? row.status : null,
    completedAt: row.completed_at,
  }));
  const progress = withLegacyBusinessTypeCompletion(businessType, rawProgress);

  return {
    tenantId,
    businessType,
    steps,
    progress,
    summary: calculateOnboardingProgress(steps, progress),
  };
}

/**
 * D12.2.1 — grava (UPSERT, nunca duplica — PK `(tenant_id, step_key)`) a
 * resolução de uma etapa: `status: "completed"` (clique em "Continuar")
 * ou `status: "skipped"` (clique em "Pular por enquanto"). `completed_at`
 * é gravado nos dois casos — é só "quando esta linha foi resolvida",
 * nunca reescrito depois. Só chamado depois que quem chama já validou,
 * no servidor, que `stepKey` pertence à definição do `business_type`
 * atual, que a etapa é alcançável (`isStepReachable`) e — quando
 * `status: "skipped"` — que a etapa é de fato `skippable`; este helper
 * em si não repete nenhuma dessas checagens porque ele nunca é exposto
 * como Server Action: `completeOnboardingStepAction`/
 * `skipOnboardingStepAction`/`saveBrandInfoAction`
 * (`features/onboarding/actions.ts`) são o único jeito de chegar aqui, e
 * todas validam antes.
 */
export async function markOnboardingStepProgress(
  tenantId: string,
  stepKey: string,
  status: StepProgressStatus,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.from("onboarding_progress").upsert(
    { tenant_id: tenantId, step_key: stepKey, status, completed_at: new Date().toISOString() },
    { onConflict: "tenant_id,step_key" },
  );
}

/**
 * D12.2/D12.2.1 — chamado ao final de cada Server Action de step
 * (`features/onboarding/actions.ts`). Nunca marca `onboarding_completed_at`
 * antecipadamente: só grava quando `isOnboardingComplete` (todo step
 * `required` satisfeito — "seu-negocio" especificamente `completed`, os
 * demais `completed` OU `skipped` quando `skippable`) é verdadeiro, e
 * o `UPDATE` só afeta a linha se `onboarding_completed_at` ainda for
 * `NULL` — mesma guarda de idempotência de sempre (D12.0 §H;
 * `saveBrandInfoAction` original já fazia um `UPDATE` sem essa cláusula
 * porque lá o campo em si fazia parte do mesmo UPDATE que os dados; aqui
 * a cláusula evita um UPDATE void redundante a cada nova etapa concluída
 * depois que o onboarding já foi marcado completo). Não altera o trigger
 * de auditoria (`private.audit_tenant_changes`, migration
 * 20260817220019) nem nenhum dos consumidores existentes de
 * `onboarding_completed_at` — eles continuam lendo a mesma coluna, sem
 * saber (nem precisar saber) que agora é derivada de várias etapas.
 */
export async function recomputeOnboardingCompletion(tenantId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const state = await resolveOnboardingState(supabase, tenantId);

  if (!isOnboardingComplete(state.steps, state.progress)) return;

  await supabase
    .from("tenants")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("id", tenantId)
    .is("onboarding_completed_at", null);
}

/**
 * D12.2 (SEGURANÇA DE ROTAS) — reexporta `isStepReachable` já resolvido
 * contra o estado atual, para `app/onboarding/[step]/page.tsx` e as
 * Server Actions de step não precisarem importar `progress-logic.ts`
 * diretamente nem reconstruir `OnboardingState` sozinhos.
 */
export function isReachable(state: OnboardingState, stepKey: string): boolean {
  return isStepReachable(state.steps, state.progress, stepKey);
}

export function currentStepKeyOf(state: OnboardingState): string | null {
  return resolveCurrentStepKey(state.steps, state.progress);
}
