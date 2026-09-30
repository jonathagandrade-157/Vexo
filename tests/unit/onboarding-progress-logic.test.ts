import { describe, expect, it } from "vitest";

import { BUSINESS_TYPE_CHOICES, isSelectableBusinessType } from "@/features/onboarding/business-type-choices";
import { withLegacyBusinessTypeCompletion } from "@/features/onboarding/legacy-business-type";
import {
  calculateOnboardingProgress,
  describeStepPosition,
  isOnboardingComplete,
  isStepReachable,
  resolveCurrentStepKey,
  resolveNextStepKey,
  resolvePreviousStepKey,
  type StepProgressEntry,
  type StepProgressStatus,
} from "@/features/onboarding/progress-logic";
import {
  getStepsForBusinessType,
  hasOnboardingWizard,
  isBusinessType,
  ONBOARDING_STEPS,
  type OnboardingStepDefinition,
} from "@/features/onboarding/step-definitions";

const ECOMMERCE_STEPS = getStepsForBusinessType("ecommerce");

function entry(stepKey: string, status: StepProgressStatus | null = "completed"): StepProgressEntry {
  return { stepKey, status, completedAt: status ? "2026-01-01T00:00:00.000Z" : null };
}

function resolveUpTo(stepKey: string, status: StepProgressStatus = "completed"): StepProgressEntry[] {
  const index = ECOMMERCE_STEPS.findIndex((step) => step.key === stepKey);
  return ECOMMERCE_STEPS.slice(0, index + 1).map((step) => entry(step.key, status));
}

describe("ONBOARDING_STEPS.ecommerce", () => {
  it("mantém somente as quatro etapas que executam uma ação real", () => {
    expect(ECOMMERCE_STEPS.map((step) => step.key)).toEqual(["segmento", "seu-negocio", "revisar", "publicar"]);
    expect(ECOMMERCE_STEPS.map((step) => step.kind)).toEqual(["data", "data", "review", "publish"]);
  });

  it("não mantém etapas que apenas simulavam configuração", () => {
    expect(ECOMMERCE_STEPS.map((step) => step.key)).not.toEqual(
      expect.arrayContaining(["identidade", "produtos", "categorias", "pagamentos", "entrega"]),
    );
  });

  it("tem keys únicas e permite pular apenas dados e revisão", () => {
    const keys = ECOMMERCE_STEPS.map((step) => step.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key) => !/^\d+$/.test(key))).toBe(true);
    expect(ECOMMERCE_STEPS.every((step) => step.required)).toBe(true);
    expect(ECOMMERCE_STEPS.map((step) => [step.key, step.skippable])).toEqual([
      ["segmento", false],
      ["seu-negocio", true],
      ["revisar", true],
      ["publicar", false],
    ]);
  });

  it("mantém apenas e-commerce com wizard disponível", () => {
    expect(hasOnboardingWizard("ecommerce")).toBe(true);
    expect(hasOnboardingWizard("restaurant")).toBe(false);
    expect(hasOnboardingWizard("adega")).toBe(false);
    expect(ONBOARDING_STEPS.restaurant).toBeUndefined();
    expect(ONBOARDING_STEPS.adega).toBeUndefined();
  });
});

describe("business-type-choices", () => {
  it("exibe exclusivamente e-commerce no produto VEXO", () => {
    expect(BUSINESS_TYPE_CHOICES.map((choice) => choice.value)).toEqual(["ecommerce"]);
    expect(isSelectableBusinessType("ecommerce")).toBe(true);
    expect(isSelectableBusinessType("restaurant")).toBe(false);
    expect(isSelectableBusinessType("adega")).toBe(false);
  });

  it("valida somente os tipos persistidos pelo banco", () => {
    expect(isBusinessType("ecommerce")).toBe(true);
    expect(isBusinessType("restaurant")).toBe(true);
    expect(isBusinessType("adega")).toBe(true);
    expect(isBusinessType("padaria")).toBe(false);
    expect(isBusinessType(null)).toBe(false);
  });
});

describe("withLegacyBusinessTypeCompletion", () => {
  it("não sintetiza progresso sem business_type", () => {
    expect(withLegacyBusinessTypeCompletion(null, [])).toEqual([]);
  });

  it("sintetiza segmento para tenant legado que já tinha business_type", () => {
    const result = withLegacyBusinessTypeCompletion("ecommerce", [entry("seu-negocio")]);
    expect(result).toContainEqual({ stepKey: "segmento", status: "completed", completedAt: null });
  });

  it("não duplica uma linha real de segmento", () => {
    const real = entry("segmento");
    const result = withLegacyBusinessTypeCompletion("ecommerce", [real, entry("seu-negocio")]);
    expect(result.filter((progress) => progress.stepKey === "segmento")).toEqual([real]);
  });
});

describe("navegação e conclusão do onboarding", () => {
  it("começa em segmento e avança somente quando a etapa anterior foi concluída", () => {
    expect(resolveCurrentStepKey(ECOMMERCE_STEPS, [])).toBe("segmento");
    expect(isStepReachable(ECOMMERCE_STEPS, [], "seu-negocio")).toBe(false);
    expect(resolveCurrentStepKey(ECOMMERCE_STEPS, [entry("segmento")])).toBe("seu-negocio");
    expect(isStepReachable(ECOMMERCE_STEPS, [entry("segmento")], "seu-negocio")).toBe(true);
  });

  it("aceita skipped nos dados da loja e permite avançar", () => {
    const progress = resolveUpTo("publicar").map((item) =>
      item.stepKey === "seu-negocio" ? entry("seu-negocio", "skipped") : item,
    );
    expect(isOnboardingComplete(ECOMMERCE_STEPS, progress)).toBe(true);
  });

  it("só conclui depois de publicar", () => {
    expect(isOnboardingComplete(ECOMMERCE_STEPS, resolveUpTo("revisar"))).toBe(false);
    expect(isOnboardingComplete(ECOMMERCE_STEPS, resolveUpTo("publicar"))).toBe(true);
  });

  it("protege acesso direto a etapas futuras e keys removidas", () => {
    expect(isStepReachable(ECOMMERCE_STEPS, [], "publicar")).toBe(false);
    expect(isStepReachable(ECOMMERCE_STEPS, resolveUpTo("publicar"), "produtos")).toBe(false);
  });

  it("resolve próxima e anterior pela definição atual", () => {
    expect(resolveNextStepKey(ECOMMERCE_STEPS, "segmento")).toBe("seu-negocio");
    expect(resolveNextStepKey(ECOMMERCE_STEPS, "seu-negocio")).toBe("revisar");
    expect(resolvePreviousStepKey(ECOMMERCE_STEPS, "revisar")).toBe("seu-negocio");
    expect(resolveNextStepKey(ECOMMERCE_STEPS, "publicar")).toBeNull();
    expect(resolvePreviousStepKey(ECOMMERCE_STEPS, "segmento")).toBeNull();
  });

  it("calcula posição e progresso com quatro etapas", () => {
    expect(describeStepPosition(ECOMMERCE_STEPS, "revisar")).toEqual({ stepNumber: 3, totalSteps: 4, percentage: 75 });
    expect(calculateOnboardingProgress(ECOMMERCE_STEPS, [])).toMatchObject({
      totalSteps: 4,
      currentStepNumber: 1,
      currentStepKey: "segmento",
      percentage: 25,
      isComplete: false,
    });
    expect(calculateOnboardingProgress(ECOMMERCE_STEPS, resolveUpTo("publicar"))).toMatchObject({
      totalSteps: 4,
      currentStepNumber: 4,
      currentStepKey: "publicar",
      percentage: 100,
      resolvedRequiredCount: 4,
      completedRequiredCount: 4,
      isComplete: true,
    });
  });

  it("retorna estados seguros para definição vazia ou key desconhecida", () => {
    expect(getStepsForBusinessType(null)).toEqual([]);
    expect(resolveCurrentStepKey([], [])).toBeNull();
    expect(isOnboardingComplete([], [])).toBe(false);
    expect(resolveNextStepKey(ECOMMERCE_STEPS, "inexistente")).toBeNull();
    expect(resolvePreviousStepKey(ECOMMERCE_STEPS, "inexistente")).toBeNull();
    expect(describeStepPosition(ECOMMERCE_STEPS, "inexistente")).toBeNull();
  });

  it.each([
    ["segmento", 1, 25],
    ["seu-negocio", 2, 50],
    ["revisar", 3, 75],
    ["publicar", 4, 100],
  ] as const)("descreve a posição de %s", (stepKey, stepNumber, percentage) => {
    expect(describeStepPosition(ECOMMERCE_STEPS, stepKey)).toEqual({ stepNumber, totalSteps: 4, percentage });
  });

  it.each(["segmento", "publicar"])(
    "não considera o fluxo concluído quando a etapa obrigatória %s está skipped",
    (skippedKey) => {
      const progress = resolveUpTo("publicar").map((item) =>
        item.stepKey === skippedKey ? entry(skippedKey, "skipped") : item,
      );
      expect(isOnboardingComplete(ECOMMERCE_STEPS, progress)).toBe(false);
    },
  );

  it.each([
    [[], "segmento"],
    [[entry("segmento")], "seu-negocio"],
    [[entry("segmento"), entry("seu-negocio")], "revisar"],
    [[entry("segmento"), entry("seu-negocio"), entry("revisar")], "publicar"],
  ] as const)("retoma sempre na primeira etapa pendente", (progress, expected) => {
    expect(resolveCurrentStepKey(ECOMMERCE_STEPS, progress)).toBe(expected);
  });
});

describe("motor genérico de etapas puláveis", () => {
  const STEPS: readonly OnboardingStepDefinition[] = [
    { key: "dados", title: "Dados", description: "Dados", required: true, skippable: false, kind: "data" },
    { key: "opcional", title: "Opcional", description: "Opcional", required: true, skippable: true, kind: "review" },
    { key: "fim", title: "Fim", description: "Fim", required: true, skippable: false, kind: "publish" },
  ];

  it("continua tratando skipped como resolvido somente em definição que permite pular", () => {
    const progress = [entry("dados"), entry("opcional", "skipped")];
    expect(isStepReachable(STEPS, progress, "fim")).toBe(true);
    expect(calculateOnboardingProgress(STEPS, progress)).toMatchObject({
      resolvedRequiredCount: 2,
      completedRequiredCount: 1,
      currentStepKey: "fim",
    });
  });

  it("não deixa skipped satisfazer uma etapa não pulável", () => {
    expect(isStepReachable(STEPS, [entry("dados", "skipped")], "opcional")).toBe(false);
    expect(isOnboardingComplete(STEPS, [entry("dados", "skipped"), entry("opcional"), entry("fim")])).toBe(false);
  });

  it("preserva diferença entre quantidade resolvida e concluída", () => {
    const summary = calculateOnboardingProgress(STEPS, [entry("dados"), entry("opcional", "skipped"), entry("fim")]);
    expect(summary).toMatchObject({
      resolvedRequiredCount: 3,
      completedRequiredCount: 2,
      isComplete: true,
    });
  });

  it("mantém uma etapa pulada alcançável para revisão futura", () => {
    expect(isStepReachable(STEPS, [entry("dados"), entry("opcional", "skipped")], "opcional")).toBe(true);
  });
});
