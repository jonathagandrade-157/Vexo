import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  OnboardingWizardShell,
  type OnboardingStepNavigationItem,
} from "@/components/onboarding/onboarding-wizard-shell";
import {
  describeStepPosition,
  isStepReachable,
  resolveNextStepKey,
  resolvePreviousStepKey,
  type StepProgressEntry,
} from "@/features/onboarding/progress-logic";
import { currentStepKeyOf, isReachable, resolveOnboardingState } from "@/features/onboarding/progress";
import { resolveOnboardingTenant } from "@/features/onboarding/resolve-tenant";
import {
  getStepsForBusinessType,
  isBusinessType,
  type OnboardingStepDefinition,
} from "@/features/onboarding/step-definitions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BrandInfoForm } from "../brand-info-form";
import { BusinessTypeForm } from "../business-type-form";
import { PublicarStepContent } from "./publicar-step-content";
import { RevisarStepContent } from "./revisar-step-content";

export const metadata: Metadata = { title: "Configurar minha loja — VEXO" };

function buildStepNavigation(
  steps: readonly OnboardingStepDefinition[],
  progress: readonly StepProgressEntry[],
  currentStepKey: string,
): OnboardingStepNavigationItem[] {
  return steps.map((step) => {
    const savedStatus = progress.find((entry) => entry.stepKey === step.key)?.status;
    const reachable = isStepReachable(steps, progress, step.key);
    const status: OnboardingStepNavigationItem["status"] =
      step.key === currentStepKey
        ? "current"
        : savedStatus === "completed"
          ? "completed"
          : savedStatus === "skipped"
            ? "skipped"
            : reachable
              ? "available"
              : "locked";

    return {
      key: step.key,
      title: step.title,
      href: reachable ? `/onboarding/${step.key}` : undefined,
      status,
    };
  });
}

/**
 * D12.2 — dispatcher único de `/onboarding/{step}`. Nunca confia em
 * `step` (o segmento de rota) para decidir o que renderizar sem antes
 * validar contra o estado real do tenant (SEGURANÇA DE ROTAS, D12.2):
 *
 * 1. sessão + tenant OWNER com onboarding pendente (mesmo gate de
 *    sempre) — sem isso, nem chega a olhar `step`.
 * 2. `step === "segmento"` é sempre servido (D15.1.1 — nova primeira
 *    etapa, a única que não depende de uma definição já resolvida — é
 *    ela quem define `business_type`).
 * 3. `step === "seu-negocio"` só é servido com `business_type` já
 *    definido (D15.1.1 — antes definia `business_type` ela mesma; agora
 *    depende de "segmento" já ter sido resolvida) — sem isso, redireciona
 *    para "segmento".
 * 4. sem `business_type` ainda e `step` não é "segmento"/"seu-negocio" →
 *    redireciona para "segmento" (nunca renderiza uma etapa de uma
 *    definição que não existe).
 * 5. onboarding já completo (todas as `required` concluídas) → /painel
 *    (nunca mostra uma etapa depois de tudo pronto).
 * 6. `step` não pertence à definição do `business_type` atual, OU não é
 *    alcançável ainda (alguma etapa `required` anterior está pendente) →
 *    redireciona para a etapa atual real — fecha "acessar
 *    /onboarding/publicar direto" e "stepKey de outro business_type".
 */
export default async function OnboardingStepPage({ params }: { params: Promise<{ step: string }> }) {
  const { step: stepKey } = await params;
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenant = await resolveOnboardingTenant(supabase, true);
  if (!tenant) {
    const completedTenant = await resolveOnboardingTenant(supabase, false);
    redirect(completedTenant ? "/painel" : "/sem-loja");
  }

  if (stepKey === "segmento") {
    // D15.1.1 — progresso exibido usa a definição de 'ecommerce' como
    // referência (única implementada nesta fase) só para a barra/"Etapa X
    // de Y" fazerem sentido antes de business_type existir — nunca usada
    // para decidir alcançabilidade, que aqui é sempre trivialmente
    // permitida (é a primeira etapa possível, mesmo raciocínio que
    // "seu-negocio" tinha antes desta mudança).
    const displaySteps = getStepsForBusinessType("ecommerce");
    const position = describeStepPosition(displaySteps, "segmento") ?? { stepNumber: 1, totalSteps: displaySteps.length || 1, percentage: 0 };
    const existingProgress = tenant.business_type
      ? (await resolveOnboardingState(supabase, tenant.id)).progress
      : [];

    return (
      <OnboardingWizardShell
        currentStepNumber={position.stepNumber}
        description="A VEXO organiza catálogo, pedidos e checkout para sua loja online."
        percentage={position.percentage}
        stepNavigation={buildStepNavigation(displaySteps, existingProgress, "segmento")}
        title="Vamos configurar sua loja online"
        totalSteps={position.totalSteps}
      >
        <BusinessTypeForm />
      </OnboardingWizardShell>
    );
  }

  if (stepKey === "seu-negocio") {
    if (!tenant.business_type) {
      // D15.1.1 — "seu-negocio" não define mais business_type; sem ele já
      // definido (por "segmento"), não há o que exibir aqui ainda.
      redirect("/onboarding/segmento");
    }

    const displayBusinessType = isBusinessType(tenant.business_type) ? tenant.business_type : "ecommerce";
    const displaySteps = getStepsForBusinessType(displayBusinessType);
    const position = describeStepPosition(displaySteps, "seu-negocio") ?? { stepNumber: 1, totalSteps: displaySteps.length || 1, percentage: 0 };
    const state = await resolveOnboardingState(supabase, tenant.id);
    const brandInfoStatus = state.progress.find((entry) => entry.stepKey === "seu-negocio")?.status;

    return (
      <OnboardingWizardShell
        backHref="/onboarding/segmento"
        currentStepNumber={position.stepNumber}
        description="Essas informações ajudam a Vexo a criar uma experiência personalizada para o seu e-commerce."
        percentage={position.percentage}
        stepNavigation={buildStepNavigation(displaySteps, state.progress, "seu-negocio")}
        title="Conte um pouco sobre sua marca"
        totalSteps={position.totalSteps}
      >
        <BrandInfoForm
          allowSkip={brandInfoStatus !== "completed"}
          defaultValues={{
            storeName: tenant.name,
            segment: tenant.segment ?? "",
            description: tenant.description ?? "",
            instagram: tenant.instagram_handle ?? "",
            whatsapp: tenant.whatsapp_phone ?? "",
            email: tenant.contact_email ?? "",
          }}
        />
      </OnboardingWizardShell>
    );
  }

  if (!tenant.business_type) {
    redirect("/onboarding/segmento");
  }

  const state = await resolveOnboardingState(supabase, tenant.id);

  if (state.summary.isComplete) redirect("/painel");

  const step = state.steps.find((s) => s.key === stepKey);
  if (!step || step.kind === "data" || !isReachable(state, stepKey)) {
    const currentKey = currentStepKeyOf(state) ?? "segmento";
    redirect(`/onboarding/${currentKey}`);
  }

  const position = describeStepPosition(state.steps, stepKey)!;
  const backKey = resolvePreviousStepKey(state.steps, stepKey);
  const nextKey = resolveNextStepKey(state.steps, stepKey);
  const backHref = backKey ? `/onboarding/${backKey}` : undefined;
  const nextHref = nextKey ? `/onboarding/${nextKey}` : "/painel";
  const savedStatus = state.progress.find((entry) => entry.stepKey === step.key)?.status;

  return (
    <OnboardingWizardShell
      backHref={backHref}
      currentStepNumber={position.stepNumber}
      description={step.description}
      percentage={position.percentage}
      stepNavigation={buildStepNavigation(state.steps, state.progress, stepKey)}
      title={step.title}
      totalSteps={position.totalSteps}
    >
      {step.kind === "review" ? (
        <RevisarStepContent allowSkip={savedStatus !== "completed"} nextHref={nextHref} tenant={tenant} />
      ) : null}
      {step.kind === "publish" ? <PublicarStepContent /> : null}
    </OnboardingWizardShell>
  );
}
