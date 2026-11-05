import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  getPublicEnv: () => ({ NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100" }),
  getServerEnv: () => ({ TRIAL_HASH_SECRET: "synthetic-confirmation-secret-not-production" }),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn(), createSupabaseServiceRoleClient: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn(), get: vi.fn(), delete: vi.fn() }) }));

import { signUpAction } from "@/features/auth/actions";
import { initialSignUpState } from "@/features/auth/schema";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

beforeEach(() => vi.clearAllMocks());
it("does not enrich a profile or create a tenant/trial before email confirmation provides a session", async () => {
  const from = vi.fn(() => { throw new Error("Profile write attempted without a verified session"); });
  const rpc = vi.fn();
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { signUp: vi.fn().mockResolvedValue({ data: { user: { id: "11111111-1111-4111-8111-111111111111" }, session: null }, error: null }) },
    from, rpc,
  } as never);
  const form = new FormData();
  for (const [key, value] of Object.entries({ storeName: "Loja sintética", fullName: "Conta sintética", email: "confirmation@example.test", phone: "11999999999", document: "11144477735", password: "Synthetic-password-A9!", acceptTerms: "on" })) form.set(key, value);
  await expect(signUpAction(initialSignUpState, form)).rejects.toThrow("REDIRECT:/confirmar-email");
  expect(from).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
  expect(createSupabaseServiceRoleClient).not.toHaveBeenCalled();
});
