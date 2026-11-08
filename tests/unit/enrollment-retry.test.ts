import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn(), createSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/features/painel/current-tenant", () => ({ getCurrentMembership: vi.fn() }));
vi.mock("@/features/auth/post-login-destination", () => ({ resolvePostLoginDestination: vi.fn() }));
vi.mock("@/features/auth/pending-signup-cookie", () => ({ clearPendingSignup: vi.fn() }));
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/features/painel/current-tenant";
import { resolvePostLoginDestination } from "@/features/auth/post-login-destination";
import { completeEnrollment } from "@/features/auth/enrollment";
const userId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const input = { userId, storeName: "Synthetic", fullName: "Synthetic", phone: "11999999999", documentHash: "a".repeat(64) };
const tenantRpc = vi.fn(); const trialRpc = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolvePostLoginDestination).mockResolvedValue("/cadastro");
  vi.mocked(getCurrentMembership).mockResolvedValue({ roleKey: "OWNER", tenant: { id: tenantId, status: "pending", onboarding_completed_at: null } } as never);
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId, email_confirmed_at: "2026-01-01" } }, error: null }) },
    rpc: tenantRpc,
    from: () => { const builder = { select: () => builder, eq: () => builder, maybeSingle: async () => ({ data: null, error: null }), update: () => builder,
      then: (accept: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(accept) }; return builder; },
  } as never);
  trialRpc.mockResolvedValue({ error: null });
  vi.mocked(createSupabaseServiceRoleClient).mockReturnValue({ rpc: trialRpc } as never);
});
it("reuses an owned incomplete tenant after a failed trial operation without creating another store", async () => {
  trialRpc.mockResolvedValueOnce({ error: { code: "temporary" } });
  expect((await completeEnrollment(input)).status).toBe("error");
  expect(await completeEnrollment(input)).toEqual({ status: "complete", destination: `/trial/sucesso?tenant=${tenantId}` });
  expect(tenantRpc).not.toHaveBeenCalled();
  expect(trialRpc).toHaveBeenLastCalledWith("start_trial_for_tenant", { p_user_id: userId, p_tenant_id: tenantId, p_document_hash: input.documentHash });
});
