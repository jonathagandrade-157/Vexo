"use server";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { markOnboardingStepProgress, recomputeOnboardingCompletion, resolveOnboardingState, type OnboardingState } from "./progress";
import { resolveOnboardingTenant } from "./resolve-tenant";
import { brandInfoSchema, type BrandInfoActionState, type BrandInfoInput, type OnboardingStepActionState } from "./schema";
import { isStepReachable } from "./progress-logic";
import type { OnboardingStepDefinition } from "./step-definitions";

/**
 * Etapa "seu-negocio" do wizard (D12.2) — primeira etapa da definição de
 * `ecommerce` (`features/onboarding/step-definitions.ts`), sempre a
 * primeira alcançável (nada antes dela). Grava `business_type` junto com
 * os mesmos 6 campos de marca de sempre (D12.0/arquitetura §24 Etapa 4;
 * docs/architecture/etapa-4-onboarding.md) — continua sendo o único
 * formulário de dados real do wizard nesta fase; as demais etapas são
 * "orchestrated"/"review"/"publish" e usam `completeOnboardingStepAction`
 * abaixo.
 *
 * D12.2 — NÃO grava mais `onboarding_completed_at` diretamente: essa
 * responsabilidade passou inteira para `recomputeOnboardingCompletion`,
 * chamado ao final desta action como de qualquer outra etapa. Com 8
 * etapas na definição de `ecommerce`, salvar "seu-negocio" nunca é
 * suficiente sozinho para completar o onboarding — o `UPDATE`
 * condicional em `recomputeOnboardingCompletion` garante isso (só grava
 * quando toda etapa `required` estiver concluída).
 *
 * O tenant a atualizar NUNCA vem de um campo do formulário — é resolvido
 * aqui a partir da sessão (auth.getUser() + tenant_members), exatamente
 * como resolveOnboardingTenant faz para renderizar a página. Isso fecha o
 * cenário de IDOR/tenant hopping "enviar um tenant_id de outra loja no
 * formulário": não há onde colocar esse valor para começar.
 *
 * O UPDATE roda no cliente Supabase ligado à sessão (não service_role) —
 * RLS (`has_permission(id, 'settings.update')`, Etapa 2) continua sendo a
 * autoridade final; resolver o tenant no servidor é defesa em
 * profundidade, não substituição da RLS.
 *
 * Idempotente por natureza: é um UPDATE de uma linha já existente, nunca
 * um INSERT — reenvio duplo (double submit, ou o usuário voltando à
 * página depois de já ter concluído esta etapa) não cria linha duplicada
 * nenhuma, e `markOnboardingStepCompleted` é um UPSERT pela mesma razão.
 */
export async function saveBrandInfoAction(
  _prevState: BrandInfoActionState,
  formData: FormData,
): Promise<BrandInfoActionState> {
  const parsed = brandInfoSchema.safeParse({
    storeName: formData.get("storeName"),
    businessType: formData.get("businessType"),
    segment: formData.get("segment"),
    description: formData.get("description"),
    instagram: formData.get("instagram"),
    whatsapp: formData.get("whatsapp"),
    email: formData.get("email"),
  });

  if (!parsed.success) {
    const fieldErrors: BrandInfoActionState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof BrandInfoInput;
      fieldErrors[key] ??= issue.message;
    }
    return {
      status: "error",
      fieldErrors,
      message: "Verifique os campos destacados.",
    };
  }

  const supabase = await createSupabaseServerClient();

  const tenant = await resolveOnboardingTenant(supabase, true);
  if (!tenant) {
    // Sem sessão, sem tenant, ou onboarding já concluído por outra aba —
    // não há o que salvar aqui; a página que chamou esta action já faz o
    // redirect correto no próximo GET.
    redirect("/painel");
  }

  const { storeName, businessType, segment, description, instagram, whatsapp, email } = parsed.data;

  const { error } = await supabase
    .from("tenants")
    .update({
      name: storeName,
      business_type: businessType,
      segment,
      description: description ?? null,
      instagram_handle: instagram,
      whatsapp_phone: whatsapp,
      contact_email: email,
    })
    .eq("id", tenant.id);

  if (error) {
    return {
      status: "error",
      message: "Não foi possível salvar os dados da sua loja. Tente novamente.",
    };
  }

  await markOnboardingStepProgress(tenant.id, "seu-negocio", "completed");
  await recomputeOnboardingCompletion(tenant.id);

  // Nunca uma etapa fixa — /onboarding (Server Component) resolve de
  // novo qual é a etapa atual a partir do banco e redireciona para lá.
  redirect("/onboarding");
}

/**
 * D12.2.1 — validação comum a `completeOnboardingStepAction`/
 * `skipOnboardingStepAction`: 1) tenant resolvido pela sessão, restrito a
 * OWNER com onboarding pendente (mesmo `resolveOnboardingTenant` da
 * etapa "seu-negocio" — quem não é OWNER, ou já concluiu onboarding, não
 * chega a marcar etapa nenhuma por aqui); 2) `stepKey` precisa pertencer
 * à definição real do `business_type` deste tenant
 * (`getStepsForBusinessType`, dentro de `resolveOnboardingState`) — uma
 * key de outra definição, ou inventada, é rejeitada; 3) `isStepReachable`
 * — toda etapa `required` ANTES desta já precisa estar satisfeita, senão
 * a etapa é rejeitada (fecha "pular etapas" / "acessar
 * /onboarding/publicar direto"). Nunca exportada como Server Action —
 * só usada pelas duas abaixo.
 */
async function resolveStepForAction(
  stepKey: string,
): Promise<{ tenantId: string; state: OnboardingState; step: OnboardingStepDefinition } | { error: string }> {
  const supabase = await createSupabaseServerClient();

  const tenant = await resolveOnboardingTenant(supabase, true);
  if (!tenant) {
    return { error: "Nenhuma loja pendente de configuração para esta conta." };
  }

  const state = await resolveOnboardingState(supabase, tenant.id);

  const step = state.steps.find((s) => s.key === stepKey);
  if (!step) {
    return { error: "Etapa inválida." };
  }
  if (!isStepReachable(state.steps, state.progress, stepKey)) {
    return { error: "Conclua as etapas anteriores primeiro." };
  }

  return { tenantId: tenant.id, state, step };
}

/**
 * D12.2.1 — confirma ("Continuar") uma etapa "orchestrated"/"review"/
 * "publish" (todas as etapas do wizard exceto "seu-negocio", que tem
 * `saveBrandInfoAction` própria por gravar dado real). Chamada
 * diretamente do cliente (sem `useActionState`/`<form>`), mesmo padrão
 * de `removeProductImageAction`/`confirmProductImageUploadAction`
 * (features/products/actions.ts) — não há dado de formulário aqui, só a
 * confirmação de que o lojista concluiu aquela etapa.
 *
 * A etapa nunca pode ser do tipo "data" (só "seu-negocio" é, e tem sua
 * própria action — evita que esta action vire um atalho para "concluir"
 * uma etapa que na verdade precisa de dado real).
 */
export async function completeOnboardingStepAction(stepKey: string): Promise<OnboardingStepActionState> {
  const resolved = await resolveStepForAction(stepKey);
  if ("error" in resolved) return { status: "error", message: resolved.error };
  if (resolved.step.kind === "data") {
    return { status: "error", message: "Esta etapa precisa ser preenchida no próprio formulário." };
  }

  await markOnboardingStepProgress(resolved.tenantId, stepKey, "completed");
  await recomputeOnboardingCompletion(resolved.tenantId);

  return { status: "success" };
}

/**
 * D12.2.1 — "Pular por enquanto": marca a etapa como `skipped`, nunca
 * como `completed` — nunca confundir as duas (prompt: "'skipped' satisfaz
 * o requisito de progresso, mas NÃO significa que a feature foi
 * configurada"). Mesma validação de `completeOnboardingStepAction`
 * (via `resolveStepForAction`) mais uma checagem extra: só etapas
 * `skippable` aceitam ser puladas — "seu-negocio" (a única etapa
 * `skippable: false` desta definição) nunca chega a marcar progresso por
 * aqui, mesmo que um cliente malicioso chame esta action diretamente com
 * `stepKey: "seu-negocio"`.
 */
export async function skipOnboardingStepAction(stepKey: string): Promise<OnboardingStepActionState> {
  const resolved = await resolveStepForAction(stepKey);
  if ("error" in resolved) return { status: "error", message: resolved.error };
  if (!resolved.step.skippable) {
    return { status: "error", message: "Esta etapa não pode ser pulada." };
  }

  await markOnboardingStepProgress(resolved.tenantId, stepKey, "skipped");
  await recomputeOnboardingCompletion(resolved.tenantId);

  return { status: "success" };
}
