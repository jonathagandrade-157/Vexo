import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { markOnboardingStepProgress, recomputeOnboardingCompletion } from "@/features/onboarding/progress";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

function progressRows() {
  return ["segmento", "seu-negocio", "revisar", "publicar"].map((step_key) => ({
    step_key,
    status: "completed",
    completed_at: "2026-01-01T00:00:00.000Z",
  }));
}

function completionClient(options: { tenantReadError?: boolean; progressReadError?: boolean; updateError?: boolean } = {}) {
  return {
    from: vi.fn((table: string) => {
      if (table === "onboarding_progress") {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: options.progressReadError ? null : progressRows(),
                error: options.progressReadError ? { message: "progress read failed" } : null,
              }),
          }),
        };
      }

      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: options.tenantReadError ? null : { business_type: "ecommerce" },
                error: options.tenantReadError ? { message: "tenant read failed" } : null,
              }),
          }),
        }),
        update: () => ({
          eq: () => ({
            is: () =>
              Promise.resolve({
                data: null,
                error: options.updateError ? { message: "completion update failed" } : null,
              }),
          }),
        }),
      };
    }),
  };
}

describe("persistência do onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna false quando o progresso não pode ser salvo", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      from: () => ({ upsert: () => Promise.resolve({ error: { message: "write failed" } }) }),
    } as never);

    await expect(markOnboardingStepProgress(TENANT_ID, "revisar", "completed")).resolves.toBe(false);
  });

  it("nunca rejeita quando a gravação lança uma exceção inesperada", async () => {
    vi.mocked(createSupabaseServerClient).mockRejectedValue(new Error("client unavailable"));

    await expect(markOnboardingStepProgress(TENANT_ID, "revisar", "completed")).resolves.toBe(false);
  });

  it("retorna false quando não consegue reler o estado antes de concluir", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(completionClient({ progressReadError: true }) as never);

    await expect(recomputeOnboardingCompletion(TENANT_ID)).resolves.toBe(false);
  });

  it("retorna false quando o update final de onboarding_completed_at falha", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(completionClient({ updateError: true }) as never);

    await expect(recomputeOnboardingCompletion(TENANT_ID)).resolves.toBe(false);
  });

  it("retorna true somente depois de persistir a conclusão", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(completionClient() as never);

    await expect(recomputeOnboardingCompletion(TENANT_ID)).resolves.toBe(true);
  });
});
