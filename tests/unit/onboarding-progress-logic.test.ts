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
} from "@/features/onboarding/step-definitions";

/**
 * D12.2/D12.2.1 — toda a lógica de progresso do wizard vive em
 * `progress-logic.ts` como funções puras (sem banco, sem React) —
 * testável sem nenhuma infraestrutura. Mesmo princípio já aplicado a
 * `resolveProductImagePreview` (D11.2) e `validateProductImageUploadRequest`
 * (D11.8).
 *
 * D15.1.1 — "segmento" passou a ser a primeira etapa da definição de
 * `ecommerce` (9 etapas agora, não mais 8); "seu-negocio" deixou de
 * definir `business_type` e passou a ser a segunda. Todo teste abaixo que
 * dependia da ordem/contagem antiga foi atualizado; a lógica em si
 * (`progress-logic.ts`) não mudou uma linha — só a definição de dados
 * (`step-definitions.ts`) mudou, o que já era o resultado esperado da
 * investigação desta etapa (o motor é genérico/baseado em índice).
 */

const ECOMMERCE_STEPS = getStepsForBusinessType("ecommerce");
const REQUIRED_KEYS = ECOMMERCE_STEPS.filter((s) => s.required).map((s) => s.key);

function entry(stepKey: string, status: StepProgressStatus | null): StepProgressEntry {
  return { stepKey, status, completedAt: status ? "2026-01-01T00:00:00.000Z" : null };
}

/** Todas as etapas até `stepKey` (inclusive) com o status dado — default "completed". */
function resolveUpTo(stepKey: string, status: StepProgressStatus = "completed"): StepProgressEntry[] {
  const index = ECOMMERCE_STEPS.findIndex((s) => s.key === stepKey);
  return ECOMMERCE_STEPS.slice(0, index + 1).map((s) => entry(s.key, status));
}

// 12. definição ecommerce completa
describe("ONBOARDING_STEPS.ecommerce — definição completa", () => {
  it("tem exatamente as 9 etapas documentadas (D12.1/D12.2 + D15.1.1), nesta ordem", () => {
    expect(ECOMMERCE_STEPS.map((s) => s.key)).toEqual([
      "segmento",
      "seu-negocio",
      "identidade",
      "produtos",
      "categorias",
      "pagamentos",
      "entrega",
      "revisar",
      "publicar",
    ]);
  });

  it("toda key é única", () => {
    const keys = ECOMMERCE_STEPS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("nenhuma key é um índice numérico", () => {
    for (const step of ECOMMERCE_STEPS) {
      expect(step.key).not.toMatch(/^\d+$/);
    }
  });

  it("a primeira etapa é do tipo 'data' (segmento) e a última é 'publish' (publicar)", () => {
    expect(ECOMMERCE_STEPS[0]?.key).toBe("segmento");
    expect(ECOMMERCE_STEPS[0]?.kind).toBe("data");
    expect(ECOMMERCE_STEPS[ECOMMERCE_STEPS.length - 1]?.kind).toBe("publish");
  });

  it("toda etapa tem key/title/description/required/skippable/kind preenchidos", () => {
    for (const step of ECOMMERCE_STEPS) {
      expect(step.key.length).toBeGreaterThan(0);
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.description.length).toBeGreaterThan(0);
      expect(typeof step.required).toBe("boolean");
      expect(typeof step.skippable).toBe("boolean");
      expect(["data", "orchestrated", "review", "publish"]).toContain(step.kind);
    }
  });

  // D15.1.1: "segmento" entra na mesma regra de "seu-negocio" — nenhuma das
  // duas pode ser pulada (dado que define o resto do wizard).
  it("'segmento' e 'seu-negocio' são skippable: false — as demais 'orchestrated' são skippable: true", () => {
    expect(ECOMMERCE_STEPS.find((s) => s.key === "segmento")?.skippable).toBe(false);
    expect(ECOMMERCE_STEPS.find((s) => s.key === "seu-negocio")?.skippable).toBe(false);
    for (const key of ["identidade", "produtos", "categorias", "pagamentos", "entrega"]) {
      expect(ECOMMERCE_STEPS.find((s) => s.key === key)?.skippable).toBe(true);
    }
  });

  it("'revisar' e 'publicar' não são skippable (nada para pular numa revisão/publicação)", () => {
    expect(ECOMMERCE_STEPS.find((s) => s.key === "revisar")?.skippable).toBe(false);
    expect(ECOMMERCE_STEPS.find((s) => s.key === "publicar")?.skippable).toBe(false);
  });

  it("toda etapa skippable tem um prompt (headline/subtext/continueLabel) para a UI", () => {
    for (const step of ECOMMERCE_STEPS.filter((s) => s.skippable)) {
      expect(step.prompt?.headline.length).toBeGreaterThan(0);
      expect(step.prompt?.subtext.length).toBeGreaterThan(0);
      expect(step.prompt?.continueLabel.length).toBeGreaterThan(0);
    }
  });

  it("restaurant/adega aceitos por isBusinessType mas sem wizard implementado (D15.1.1 não altera a modelagem deles)", () => {
    expect(isBusinessType("restaurant")).toBe(true);
    expect(isBusinessType("adega")).toBe(true);
    expect(hasOnboardingWizard("restaurant")).toBe(false);
    expect(hasOnboardingWizard("adega")).toBe(false);
    expect(hasOnboardingWizard("ecommerce")).toBe(true);
    expect(ONBOARDING_STEPS.restaurant).toBeUndefined();
    expect(ONBOARDING_STEPS.adega).toBeUndefined();
  });
});

// D15.1.1 — o que a etapa "segmento" oferece (BUSINESS_TYPE_CHOICES) e a
// autoridade real de "isto pode ser salvo" (isSelectableBusinessType),
// mesma lista reaproveitada pela UI (BusinessTypeForm) e pela Server
// Action (saveBusinessTypeAction).
describe("business-type-choices — o que a etapa 'segmento' oferece", () => {
  it("e-commerce é selecionável", () => {
    expect(BUSINESS_TYPE_CHOICES.find((c) => c.value === "ecommerce")?.enabled).toBe(true);
    expect(isSelectableBusinessType("ecommerce")).toBe(true);
  });

  it("restaurante aparece, mas desabilitado — não selecionável", () => {
    expect(BUSINESS_TYPE_CHOICES.find((c) => c.value === "restaurant")?.enabled).toBe(false);
    expect(isSelectableBusinessType("restaurant")).toBe(false);
  });

  it("adega aparece, mas desabilitada — não selecionável", () => {
    expect(BUSINESS_TYPE_CHOICES.find((c) => c.value === "adega")?.enabled).toBe(false);
    expect(isSelectableBusinessType("adega")).toBe(false);
  });

  it("as 3 opções da coluna (migration 20260817220093) estão todas presentes na UI, mesmo as desabilitadas", () => {
    expect(BUSINESS_TYPE_CHOICES.map((c) => c.value).sort()).toEqual(["adega", "ecommerce", "restaurant"]);
  });
});

// D15.1.1 — síntese de compatibilidade para tenants legados (business_type
// já definido pelo antigo formulário único "seu-negocio", sem linha real
// de progresso para "segmento").
describe("withLegacyBusinessTypeCompletion — compatibilidade com tenants legados", () => {
  it("business_type null (nunca chegou à etapa) — não sintetiza nada, progresso intacto", () => {
    const result = withLegacyBusinessTypeCompletion(null, []);
    expect(result).toEqual([]);
  });

  it("tenant legado — business_type já definido, nenhuma linha real para 'segmento' — sintetiza 'segmento': 'completed'", () => {
    const result = withLegacyBusinessTypeCompletion("ecommerce", [entry("seu-negocio", "completed")]);
    expect(result).toContainEqual({ stepKey: "segmento", status: "completed", completedAt: null });
    expect(result).toHaveLength(2);
  });

  it("tenant já configurado pelo NOVO fluxo — linha real de 'segmento' já existe — nunca duplica", () => {
    const real = entry("segmento", "completed");
    const result = withLegacyBusinessTypeCompletion("ecommerce", [real, entry("seu-negocio", "completed")]);
    expect(result.filter((p) => p.stepKey === "segmento")).toHaveLength(1);
    expect(result.find((p) => p.stepKey === "segmento")).toEqual(real);
  });
});

// 10. business_type inválido
describe("getStepsForBusinessType — business_type inválido/ausente", () => {
  it("retorna [] para null", () => {
    expect(getStepsForBusinessType(null)).toEqual([]);
  });

  it("isBusinessType rejeita string arbitrária/lixo do banco", () => {
    expect(isBusinessType("padaria")).toBe(false);
    expect(isBusinessType("")).toBe(false);
    expect(isBusinessType(undefined)).toBe(false);
    expect(isBusinessType(123)).toBe(false);
  });
});

// 1. total de steps
describe("total de steps", () => {
  it("ecommerce tem 9 etapas (D15.1.1 adicionou 'segmento')", () => {
    expect(ECOMMERCE_STEPS.length).toBe(9);
  });
});

describe("'segmento' é obrigatória e nunca pulável — primeira etapa real do wizard", () => {
  it("progresso vazio → a etapa atual é sempre 'segmento', nunca 'seu-negocio' direto", () => {
    expect(resolveCurrentStepKey(ECOMMERCE_STEPS, [])).toBe("segmento");
  });

  it("com 'segmento' resolvida (novo fluxo: business_type salvo), a atual passa a ser 'seu-negocio'", () => {
    const p = [entry("segmento", "completed")];
    expect(resolveCurrentStepKey(ECOMMERCE_STEPS, p)).toBe("seu-negocio");
  });

  it("'segmento' skipped (nunca gravável pelo fluxo real — skippable: false) ainda assim não satisfaz o requisito", () => {
    const p = [entry("segmento", "skipped")];
    expect(isStepReachable(ECOMMERCE_STEPS, p, "seu-negocio")).toBe(false);
  });

  it("sem 'segmento' resolvida, 'seu-negocio' NUNCA é alcançável — fecha o atalho 'pular direto para seu-negocio'", () => {
    expect(isStepReachable(ECOMMERCE_STEPS, [], "seu-negocio")).toBe(false);
  });
});

// D12.2.1 — item 1 da lista de testes pedida: "Seu negócio" é obrigatório (nunca satisfeito por skip).
describe("'seu-negocio' é obrigatório — nunca satisfeito por skipped", () => {
  it("com 'seu-negocio' skipped (artificialmente) e todo o resto completed, o onboarding NÃO é considerado completo", () => {
    // Cenário defensivo: mesmo que uma linha 'skipped' exista para
    // 'seu-negocio' (nunca gravada pelo fluxo real — skipOnboardingStepAction
    // rejeita isso no servidor, features/onboarding/actions.ts), a lógica
    // pura por si só já não aceita — ela exige especificamente "completed"
    // para qualquer etapa não-skippable.
    const p = resolveUpTo("publicar", "completed").map((e) => (e.stepKey === "seu-negocio" ? entry("seu-negocio", "skipped") : e));
    expect(isOnboardingComplete(ECOMMERCE_STEPS, p)).toBe(false);
  });

  it("'seu-negocio' pending (só 'segmento' resolvida) nunca é alcançável 'pulando' — é sempre a etapa atual", () => {
    expect(resolveCurrentStepKey(ECOMMERCE_STEPS, [entry("segmento", "completed")])).toBe("seu-negocio");
  });

  it("com 'segmento'/'seu-negocio' completed e as 6 etapas do meio puladas + revisar/publicar completed, o onboarding conclui", () => {
    const p = [
      entry("segmento", "completed"),
      entry("seu-negocio", "completed"),
      entry("identidade", "skipped"),
      entry("produtos", "skipped"),
      entry("categorias", "skipped"),
      entry("pagamentos", "skipped"),
      entry("entrega", "skipped"),
      entry("revisar", "completed"),
      entry("publicar", "completed"),
    ];
    expect(isOnboardingComplete(ECOMMERCE_STEPS, p)).toBe(true);
  });
});

// 2. etapa opcional pode ser completed / 3. etapa opcional pode ser skipped / 4. skipped permite avançar / 5. skipped não é tratado como completed
describe("etapas skippable — completed vs skipped", () => {
  it("uma etapa skippable satisfaz o requisito de progresso tanto completed quanto skipped", () => {
    const completed = [...resolveUpTo("seu-negocio"), entry("identidade", "completed")];
    const skipped = [...resolveUpTo("seu-negocio"), entry("identidade", "skipped")];
    expect(isStepReachable(ECOMMERCE_STEPS, completed, "produtos")).toBe(true);
    expect(isStepReachable(ECOMMERCE_STEPS, skipped, "produtos")).toBe(true);
  });

  it("skipped avança a etapa atual, exatamente como completed", () => {
    const completed = [...resolveUpTo("seu-negocio"), entry("identidade", "completed")];
    const skipped = [...resolveUpTo("seu-negocio"), entry("identidade", "skipped")];
    expect(resolveCurrentStepKey(ECOMMERCE_STEPS, completed)).toBe("produtos");
    expect(resolveCurrentStepKey(ECOMMERCE_STEPS, skipped)).toBe("produtos");
  });

  it("skipped NUNCA é contado como completed — completedRequiredCount só soma status 'completed'", () => {
    const p = [entry("segmento", "completed"), entry("seu-negocio", "completed"), entry("identidade", "skipped")];
    const summary = calculateOnboardingProgress(ECOMMERCE_STEPS, p);
    expect(summary.completedRequiredCount).toBe(2); // 'segmento' + 'seu-negocio'
    expect(summary.resolvedRequiredCount).toBe(3); // + 'identidade' (skipped conta como resolvida)
  });

  it("uma etapa 'pending' (sem linha nenhuma) nunca satisfaz o requisito, mesmo skippable", () => {
    expect(isOnboardingComplete(ECOMMERCE_STEPS, resolveUpTo("seu-negocio"))).toBe(false);
    expect(isStepReachable(ECOMMERCE_STEPS, resolveUpTo("seu-negocio"), "categorias")).toBe(false);
  });
});

// 6. onboarding_completed_at pode ser preenchido com várias etapas skipped
describe("isOnboardingComplete com múltiplas etapas skipped", () => {
  it("todo o meio do wizard skipped, 'segmento'/'seu-negocio'/'revisar'/'publicar' completed → true", () => {
    const p = [
      entry("segmento", "completed"),
      entry("seu-negocio", "completed"),
      entry("identidade", "skipped"),
      entry("produtos", "skipped"),
      entry("categorias", "skipped"),
      entry("pagamentos", "skipped"),
      entry("entrega", "skipped"),
      entry("revisar", "completed"),
      entry("publicar", "completed"),
    ];
    expect(isOnboardingComplete(ECOMMERCE_STEPS, p)).toBe(true);
  });

  it("falta 'publicar' (nunca pode ser satisfeita por skip, não é skippable) → false mesmo com tudo mais resolvido", () => {
    const p = [
      entry("segmento", "completed"),
      entry("seu-negocio", "completed"),
      entry("identidade", "skipped"),
      entry("produtos", "skipped"),
      entry("categorias", "skipped"),
      entry("pagamentos", "skipped"),
      entry("entrega", "skipped"),
      entry("revisar", "completed"),
    ];
    expect(isOnboardingComplete(ECOMMERCE_STEPS, p)).toBe(false);
  });

  it("progresso vazio → false", () => {
    expect(isOnboardingComplete(ECOMMERCE_STEPS, [])).toBe(false);
  });

  it("definição vazia (business_type sem wizard) → false, nunca true por omissão", () => {
    expect(isOnboardingComplete([], [])).toBe(false);
  });
});

// 7. usuário pode voltar para uma etapa skipped
describe("voltar para uma etapa skipped", () => {
  it("uma etapa já skipped continua alcançável (revisitável), exatamente como uma completed", () => {
    const p = [
      entry("segmento", "completed"),
      entry("seu-negocio", "completed"),
      entry("identidade", "skipped"),
      entry("produtos", "completed"),
    ];
    expect(isStepReachable(ECOMMERCE_STEPS, p, "identidade")).toBe(true);
  });

  it("a posição exibida ao revisitar reflete a etapa revisitada, não a etapa atual do progresso", () => {
    const p = [
      entry("segmento", "completed"),
      entry("seu-negocio", "completed"),
      entry("identidade", "skipped"),
      entry("produtos", "completed"),
      entry("categorias", "skipped"),
    ]; // atual seria 'pagamentos' (etapa 6 de 9)
    const position = describeStepPosition(ECOMMERCE_STEPS, "identidade"); // etapa 3 de 9
    expect(position).toEqual({ stepNumber: 3, totalSteps: 9, percentage: 33 });
    expect(resolveCurrentStepKey(ECOMMERCE_STEPS, p)).toBe("pagamentos");
  });
});

// 3/5. primeira etapa / retomada (mesmo cálculo, resolveCurrentStepKey)
describe("resolveCurrentStepKey — primeira etapa e retomada", () => {
  it("progresso vazio → primeira etapa da definição (segmento)", () => {
    expect(resolveCurrentStepKey(ECOMMERCE_STEPS, [])).toBe("segmento");
  });

  it("retomada: com 'segmento'/'seu-negocio'/'identidade' resolvidos (as duas primeiras completed, a última skipped), volta em 'produtos'", () => {
    const p = [entry("segmento", "completed"), entry("seu-negocio", "completed"), entry("identidade", "skipped")];
    expect(resolveCurrentStepKey(ECOMMERCE_STEPS, p)).toBe("produtos");
  });

  it("definição vazia (business_type sem wizard) → null", () => {
    expect(resolveCurrentStepKey([], [])).toBeNull();
  });

  it("todas as etapas required satisfeitas → cai na última etapa da definição", () => {
    const p = resolveUpTo("publicar");
    expect(resolveCurrentStepKey(ECOMMERCE_STEPS, p)).toBe("publicar");
  });
});

// próxima/anterior etapa
describe("resolveNextStepKey / resolvePreviousStepKey", () => {
  it("etapa do meio → próxima e anterior na ordem", () => {
    expect(resolveNextStepKey(ECOMMERCE_STEPS, "produtos")).toBe("categorias");
    expect(resolvePreviousStepKey(ECOMMERCE_STEPS, "categorias")).toBe("produtos");
  });

  it("última etapa → sem próxima; primeira etapa ('segmento') → sem anterior", () => {
    expect(resolveNextStepKey(ECOMMERCE_STEPS, "publicar")).toBeNull();
    expect(resolvePreviousStepKey(ECOMMERCE_STEPS, "segmento")).toBeNull();
  });

  it("'seu-negocio' (D15.1.1 — agora a segunda etapa) tem 'segmento' como anterior", () => {
    expect(resolvePreviousStepKey(ECOMMERCE_STEPS, "seu-negocio")).toBe("segmento");
    expect(resolveNextStepKey(ECOMMERCE_STEPS, "segmento")).toBe("seu-negocio");
  });

  // 9/11. step inexistente
  it("stepKey desconhecido → null nos dois", () => {
    expect(resolveNextStepKey(ECOMMERCE_STEPS, "etapa-que-nao-existe")).toBeNull();
    expect(resolvePreviousStepKey(ECOMMERCE_STEPS, "etapa-que-nao-existe")).toBeNull();
  });
});

// 9. acesso direto a uma etapa futura continua protegido
describe("isStepReachable — segurança de rotas", () => {
  it("etapa cujas required anteriores estão todas resolvidas é alcançável", () => {
    const p = resolveUpTo("categorias");
    expect(isStepReachable(ECOMMERCE_STEPS, p, "pagamentos")).toBe(true);
  });

  it("acessar /onboarding/publicar sem ter resolvido as etapas anteriores é bloqueado", () => {
    expect(isStepReachable(ECOMMERCE_STEPS, [], "publicar")).toBe(false);
  });

  it("pular direto para 'entrega' sem ter passado por 'produtos'/'categorias' é bloqueado", () => {
    const p = resolveUpTo("identidade");
    expect(isStepReachable(ECOMMERCE_STEPS, p, "entrega")).toBe(false);
  });

  it("a primeira etapa ('segmento') é sempre alcançável, mesmo com progresso vazio", () => {
    expect(isStepReachable(ECOMMERCE_STEPS, [], "segmento")).toBe(true);
  });

  it("stepKey que não pertence a esta definição nunca é alcançável", () => {
    expect(isStepReachable(ECOMMERCE_STEPS, resolveUpTo("publicar"), "mesas")).toBe(false);
  });
});

// 8. cálculo de progresso
describe("calculateOnboardingProgress", () => {
  it("progresso vazio → etapa 1 de 9 ('segmento'), 11%, não completo", () => {
    const summary = calculateOnboardingProgress(ECOMMERCE_STEPS, []);
    expect(summary).toMatchObject({
      totalSteps: 9,
      currentStepNumber: 1,
      currentStepKey: "segmento",
      resolvedRequiredCount: 0,
      completedRequiredCount: 0,
      totalRequiredCount: 9,
      percentage: 11,
      isComplete: false,
    });
  });

  it("meio do caminho (3 completed + 2 skipped de 9) → etapa 6 de 9", () => {
    const p = [
      entry("segmento", "completed"),
      entry("seu-negocio", "completed"),
      entry("identidade", "skipped"),
      entry("produtos", "completed"),
      entry("categorias", "skipped"),
    ];
    const summary = calculateOnboardingProgress(ECOMMERCE_STEPS, p);
    expect(summary.currentStepNumber).toBe(6);
    expect(summary.currentStepKey).toBe("pagamentos");
    expect(summary.resolvedRequiredCount).toBe(5);
    expect(summary.completedRequiredCount).toBe(3);
    expect(summary.isComplete).toBe(false);
  });

  it("tudo resolvido (misto completed/skipped) → etapa 9 de 9, 100%, completo", () => {
    const p = [
      entry("segmento", "completed"),
      entry("seu-negocio", "completed"),
      entry("identidade", "skipped"),
      entry("produtos", "skipped"),
      entry("categorias", "skipped"),
      entry("pagamentos", "skipped"),
      entry("entrega", "skipped"),
      entry("revisar", "completed"),
      entry("publicar", "completed"),
    ];
    const summary = calculateOnboardingProgress(ECOMMERCE_STEPS, p);
    expect(summary.totalSteps).toBe(9);
    expect(summary.currentStepNumber).toBe(9);
    expect(summary.percentage).toBe(100);
    expect(summary.isComplete).toBe(true);
    expect(summary.resolvedRequiredCount).toBe(9);
    expect(summary.completedRequiredCount).toBe(4); // segmento + seu-negocio + revisar + publicar
  });
});

describe("describeStepPosition", () => {
  it("posição de uma etapa específica reflete a posição DELA, não a etapa atual do progresso", () => {
    const position = describeStepPosition(ECOMMERCE_STEPS, "identidade"); // etapa 3 de 9
    expect(position).toEqual({ stepNumber: 3, totalSteps: 9, percentage: 33 });
  });

  it("'segmento' é sempre a etapa 1 de 9 (11%)", () => {
    expect(describeStepPosition(ECOMMERCE_STEPS, "segmento")).toEqual({ stepNumber: 1, totalSteps: 9, percentage: 11 });
  });

  it("stepKey desconhecido → null", () => {
    expect(describeStepPosition(ECOMMERCE_STEPS, "inexistente")).toBeNull();
  });
});

// referência para os testes de integração (item 11 da lista pedida: "nenhum produto/pagamento/entrega é criado automaticamente")
describe("REQUIRED_KEYS — sanity check usado como referência pelos testes de integração", () => {
  it("inclui 'segmento' + as 5 etapas orchestrated (identidade/produtos/categorias/pagamentos/entrega) como required, mas nenhuma delas está em nenhuma tabela de negócio real", () => {
    expect(REQUIRED_KEYS).toEqual(
      expect.arrayContaining(["segmento", "identidade", "produtos", "categorias", "pagamentos", "entrega"]),
    );
  });
});
