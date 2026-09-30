import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/features/onboarding/resolve-tenant", () => ({
  resolveOnboardingTenant: vi.fn(),
}));
vi.mock("@/features/onboarding/progress", () => ({
  markOnboardingStepProgress: vi.fn(),
  recomputeOnboardingCompletion: vi.fn(),
  resolveOnboardingState: vi.fn(),
}));

import { completeOnboardingStepAction, skipOnboardingStepAction } from "@/features/onboarding/actions";
import {
  markOnboardingStepProgress,
  recomputeOnboardingCompletion,
  resolveOnboardingState,
} from "@/features/onboarding/progress";
import { resolveOnboardingTenant } from "@/features/onboarding/resolve-tenant";
import { getStepsForBusinessType } from "@/features/onboarding/step-definitions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

function progress(stepKey: string) {
  return { stepKey, status: "completed" as const, completedAt: "2026-01-01T00:00:00.000Z" };
}

describe("completeOnboardingStepAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(resolveOnboardingTenant).mockResolvedValue({ id: TENANT_ID } as never);
    vi.mocked(resolveOnboardingState).mockResolvedValue({
      tenantId: TENANT_ID,
      businessType: "ecommerce",
      steps: getStepsForBusinessType("ecommerce"),
      progress: [progress("segmento"), progress("seu-negocio")],
      summary: {} as never,
    });
    vi.mocked(markOnboardingStepProgress).mockResolvedValue(true);
    vi.mocked(recomputeOnboardingCompletion).mockResolvedValue(true);
  });

  it("não avança quando a gravação da etapa falha", async () => {
    vi.mocked(markOnboardingStepProgress).mockResolvedValue(false);

    await expect(completeOnboardingStepAction("revisar")).resolves.toEqual({
      status: "error",
      message: "Não foi possível salvar esta etapa. Tente novamente.",
    });
    expect(recomputeOnboardingCompletion).not.toHaveBeenCalled();
  });

  it("não informa sucesso quando a conclusão não pode ser recalculada", async () => {
    vi.mocked(recomputeOnboardingCompletion).mockResolvedValue(false);

    await expect(completeOnboardingStepAction("revisar")).resolves.toEqual({
      status: "error",
      message: "Não foi possível atualizar o onboarding. Tente novamente.",
    });
  });

  it("transforma falha de leitura em erro esperado para a interface", async () => {
    vi.mocked(resolveOnboardingState).mockRejectedValue(new Error("database unavailable"));

    await expect(completeOnboardingStepAction("revisar")).resolves.toEqual({
      status: "error",
      message: "Não foi possível carregar o progresso do onboarding. Tente novamente.",
    });
    expect(markOnboardingStepProgress).not.toHaveBeenCalled();
  });

  it("retorna sucesso somente depois de persistir e recalcular", async () => {
    await expect(completeOnboardingStepAction("revisar")).resolves.toEqual({ status: "success" });
    expect(markOnboardingStepProgress).toHaveBeenCalledWith(TENANT_ID, "revisar", "completed");
    expect(recomputeOnboardingCompletion).toHaveBeenCalledWith(TENANT_ID);
  });
});

describe("skipOnboardingStepAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(resolveOnboardingTenant).mockResolvedValue({ id: TENANT_ID } as never);
    vi.mocked(resolveOnboardingState).mockResolvedValue({
      tenantId: TENANT_ID,
      businessType: "ecommerce",
      steps: getStepsForBusinessType("ecommerce"),
      progress: [progress("segmento"), progress("seu-negocio")],
      summary: {} as never,
    });
    vi.mocked(markOnboardingStepProgress).mockResolvedValue(true);
    vi.mocked(recomputeOnboardingCompletion).mockResolvedValue(true);
  });

  it("grava skipped somente em etapa pulável", async () => {
    await expect(skipOnboardingStepAction("revisar")).resolves.toEqual({ status: "success" });
    expect(markOnboardingStepProgress).toHaveBeenCalledWith(TENANT_ID, "revisar", "skipped");
    expect(recomputeOnboardingCompletion).toHaveBeenCalledWith(TENANT_ID);
  });

  it("não permite pular a definição da loja", async () => {
    await expect(skipOnboardingStepAction("segmento")).resolves.toEqual({
      status: "error",
      message: "Esta etapa não pode ser pulada.",
    });
    expect(markOnboardingStepProgress).not.toHaveBeenCalled();
  });

  it("não permite pular a publicação", async () => {
    vi.mocked(resolveOnboardingState).mockResolvedValue({
      tenantId: TENANT_ID,
      businessType: "ecommerce",
      steps: getStepsForBusinessType("ecommerce"),
      progress: [progress("segmento"), progress("seu-negocio"), progress("revisar")],
      summary: {} as never,
    });

    await expect(skipOnboardingStepAction("publicar")).resolves.toEqual({
      status: "error",
      message: "Esta etapa não pode ser pulada.",
    });
    expect(markOnboardingStepProgress).not.toHaveBeenCalled();
  });

  it("não avança quando não consegue persistir o skip", async () => {
    vi.mocked(markOnboardingStepProgress).mockResolvedValue(false);

    await expect(skipOnboardingStepAction("revisar")).resolves.toEqual({
      status: "error",
      message: "Não foi possível pular esta etapa. Tente novamente.",
    });
    expect(recomputeOnboardingCompletion).not.toHaveBeenCalled();
  });
});
