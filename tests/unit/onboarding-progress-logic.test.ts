import { describe, expect, it } from "vitest";

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
  it("tem exatamente as 8 etapas documentadas em D12.1/D12.2, nesta ordem", () => {
    expect(ECOMMERCE_STEPS.map((s) => s.key)).toEqual([
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

  it("a primeira etapa é do tipo 'data' (seu-negocio) e a última é 'publish' (publicar)", () => {
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

  // D12.2.1 — REGRA PRINCIPAL: só "seu-negocio" não pode ser pulado.
  it("apenas 'seu-negocio' é skippable: false — as demais 'orchestrated' são skippable: true", () => {
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

  it("restaurant/adega aceitos por isBusinessType mas sem wizard implementado (D12.2.1 não altera a modelagem deles)", () => {
    expect(isBusinessType("restaurant")).toBe(true);
    expect(isBusinessType("adega")).toBe(true);
    expect(hasOnboardingWizard("restaurant")).toBe(false);
    expect(hasOnboardingWizard("adega")).toBe(false);
    expect(hasOnboardingWizard("ecommerce")).toBe(true);
    expect(ONBOARDING_STEPS.restaurant).toBeUndefined();
    expect(ONBOARDING_STEPS.adega).toBeUndefined();
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
  it("ecommerce tem 8 etapas", () => {
    expect(ECOMMERCE_STEPS.length).toBe(8);
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

  it("'seu-negocio' pending (nenhuma linha de progresso) nunca é alcançável 'pulando' — é sempre a etapa atual", () => {
    expect(resolveCurrentStepKey(ECOMMERCE_STEPS, [])).toBe("seu-negocio");
  });

  it("com 'seu-negocio' completed e as 6 etapas do meio puladas + revisar/publicar completed, o onboarding conclui", () => {
    const p = [
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
    const p = [entry("seu-negocio", "completed"), entry("identidade", "skipped")];
    const summary = calculateOnboardingProgress(ECOMMERCE_STEPS, p);
    expect(summary.completedRequiredCount).toBe(1); // só 'seu-negocio'
    expect(summary.resolvedRequiredCount).toBe(2); // 'seu-negocio' + 'identidade' (skipped conta como resolvida)
  });

  it("uma etapa 'pending' (sem linha nenhuma) nunca satisfaz o requisito, mesmo skippable", () => {
    expect(isOnboardingComplete(ECOMMERCE_STEPS, resolveUpTo("seu-negocio"))).toBe(false);
    expect(isStepReachable(ECOMMERCE_STEPS, resolveUpTo("seu-negocio"), "categorias")).toBe(false);
  });
});

// 6. onboarding_completed_at pode ser preenchido com várias etapas skipped
describe("isOnboardingComplete com múltiplas etapas skipped", () => {
  it("todo o meio do wizard skipped, 'seu-negocio'/'revisar'/'publicar' completed → true", () => {
    const p = [
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
    const p = [entry("seu-negocio", "completed"), entry("identidade", "skipped"), entry("produtos", "completed")];
    expect(isStepReachable(ECOMMERCE_STEPS, p, "identidade")).toBe(true);
  });

  it("a posição exibida ao revisitar reflete a etapa revisitada, não a etapa atual do progresso", () => {
    const p = [
      entry("seu-negocio", "completed"),
      entry("identidade", "skipped"),
      entry("produtos", "completed"),
      entry("categorias", "skipped"),
    ]; // atual seria 'pagamentos' (etapa 5)
    const position = describeStepPosition(ECOMMERCE_STEPS, "identidade"); // etapa 2
    expect(position).toEqual({ stepNumber: 2, totalSteps: 8, percentage: 25 });
    expect(resolveCurrentStepKey(ECOMMERCE_STEPS, p)).toBe("pagamentos");
  });
});

// 3/5. primeira etapa / retomada (mesmo cálculo, resolveCurrentStepKey)
describe("resolveCurrentStepKey — primeira etapa e retomada", () => {
  it("progresso vazio → primeira etapa da definição (seu-negocio)", () => {
    expect(resolveCurrentStepKey(ECOMMERCE_STEPS, [])).toBe("seu-negocio");
  });

  it("retomada: com 'seu-negocio' e 'identidade' resolvidos (uma completed, outra skipped), volta em 'produtos'", () => {
    const p = [entry("seu-negocio", "completed"), entry("identidade", "skipped")];
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

  it("última etapa → sem próxima; primeira etapa → sem anterior", () => {
    expect(resolveNextStepKey(ECOMMERCE_STEPS, "publicar")).toBeNull();
    expect(resolvePreviousStepKey(ECOMMERCE_STEPS, "seu-negocio")).toBeNull();
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

  it("a primeira etapa é sempre alcançável, mesmo com progresso vazio", () => {
    expect(isStepReachable(ECOMMERCE_STEPS, [], "seu-negocio")).toBe(true);
  });

  it("stepKey que não pertence a esta definição nunca é alcançável", () => {
    expect(isStepReachable(ECOMMERCE_STEPS, resolveUpTo("publicar"), "mesas")).toBe(false);
  });
});

// 8. cálculo de progresso
describe("calculateOnboardingProgress", () => {
  it("progresso vazio → etapa 1 de 8, 13%, não completo", () => {
    const summary = calculateOnboardingProgress(ECOMMERCE_STEPS, []);
    expect(summary).toMatchObject({
      totalSteps: 8,
      currentStepNumber: 1,
      currentStepKey: "seu-negocio",
      resolvedRequiredCount: 0,
      completedRequiredCount: 0,
      totalRequiredCount: 8,
      percentage: 13,
      isComplete: false,
    });
  });

  it("meio do caminho (2 completed + 2 skipped de 8) → etapa 5 de 8", () => {
    const p = [
      entry("seu-negocio", "completed"),
      entry("identidade", "skipped"),
      entry("produtos", "completed"),
      entry("categorias", "skipped"),
    ];
    const summary = calculateOnboardingProgress(ECOMMERCE_STEPS, p);
    expect(summary.currentStepNumber).toBe(5);
    expect(summary.currentStepKey).toBe("pagamentos");
    expect(summary.resolvedRequiredCount).toBe(4);
    expect(summary.completedRequiredCount).toBe(2);
    expect(summary.isComplete).toBe(false);
  });

  it("tudo resolvido (misto completed/skipped) → etapa 8 de 8, 100%, completo", () => {
    const p = [
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
    expect(summary.totalSteps).toBe(8);
    expect(summary.currentStepNumber).toBe(8);
    expect(summary.percentage).toBe(100);
    expect(summary.isComplete).toBe(true);
    expect(summary.resolvedRequiredCount).toBe(8);
    expect(summary.completedRequiredCount).toBe(3); // seu-negocio + revisar + publicar
  });
});

describe("describeStepPosition", () => {
  it("posição de uma etapa específica reflete a posição DELA, não a etapa atual do progresso", () => {
    const position = describeStepPosition(ECOMMERCE_STEPS, "identidade"); // etapa 2
    expect(position).toEqual({ stepNumber: 2, totalSteps: 8, percentage: 25 });
  });

  it("stepKey desconhecido → null", () => {
    expect(describeStepPosition(ECOMMERCE_STEPS, "inexistente")).toBeNull();
  });
});

// referência para os testes de integração (item 11 da lista pedida: "nenhum produto/pagamento/entrega é criado automaticamente")
describe("REQUIRED_KEYS — sanity check usado como referência pelos testes de integração", () => {
  it("inclui as 5 etapas orchestrated (identidade/produtos/categorias/pagamentos/entrega) como required, mas nenhuma delas está em nenhuma tabela de negócio real", () => {
    expect(REQUIRED_KEYS).toEqual(expect.arrayContaining(["identidade", "produtos", "categorias", "pagamentos", "entrega"]));
  });
});
