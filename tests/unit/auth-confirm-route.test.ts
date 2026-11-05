import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/env", () => ({ getPublicEnv: () => ({ NEXT_PUBLIC_SITE_URL: "https://vexo.example.test" }) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/features/auth/enrollment", () => ({ completeEnrollment: vi.fn() }));
vi.mock("@/features/auth/pending-signup-cookie", () => ({ pendingSignupForUser: vi.fn() }));
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { completeEnrollment } from "@/features/auth/enrollment";
import { pendingSignupForUser } from "@/features/auth/pending-signup-cookie";
import { GET } from "@/app/auth/confirm/route";
const userId = "11111111-1111-4111-8111-111111111111";
const success = { data: { user: { id: userId }, session: { access_token: "synthetic-not-logged" }, redirectType: null }, error: null };
const exchange = vi.fn(); const verify = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); exchange.mockResolvedValue(success); verify.mockResolvedValue(success);
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ auth: { exchangeCodeForSession: exchange, verifyOtp: verify } } as never);
  vi.mocked(pendingSignupForUser).mockResolvedValue(null);
});
const call = (query: string) => GET(new NextRequest(`https://vexo.example.test/auth/confirm?${query}`));
it("rejects absent/ambiguous credentials and unexpected OTP types before Auth", async () => {
  for (const query of ["", "code=x&token_hash=y", "token_hash=x&type=unexpected", "code=x&sb_flow_id=../evil"]) expect((await call(query)).headers.get("location")).toContain("/confirmar-email?error=invalid_link");
  expect(exchange).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled();
});
it("uses the verified PKCE recovery type and forwards only the flow identifier", async () => {
  exchange.mockResolvedValue({ ...success, data: { ...success.data, redirectType: "recovery" } });
  const response = await call("code=synthetic&sb_flow_id=test-flow&next=https://evil.test");
  expect(exchange).toHaveBeenCalledWith("synthetic", { flowId: "test-flow" });
  expect(response.headers.get("location")).toBe("https://vexo.example.test/redefinir-senha");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer"); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(completeEnrollment).not.toHaveBeenCalled();
});
it("does not reinterpret a signup code as recovery", async () => {
  expect((await call("code=synthetic&purpose=recovery")).headers.get("location")).toContain("error=invalid_link");
  expect(completeEnrollment).not.toHaveBeenCalled();
});
it("handles expired codes without echoing provider diagnostics", async () => {
  exchange.mockResolvedValue({ data: { user: null, session: null }, error: { message: "provider diagnostic with secret" } });
  const response = await call("code=expired&purpose=recovery");
  expect(response.headers.get("location")).toBe("https://vexo.example.test/redefinir-senha?error=invalid_link");
  expect(JSON.stringify([...response.headers])).not.toContain("provider diagnostic");
});
it("enrolls only using the authenticated envelope and redirects without tokens", async () => {
  const pending = { userId, fullName: "Synthetic", storeName: "Synthetic", phone: "11999999999", documentHash: "a".repeat(64) };
  vi.mocked(pendingSignupForUser).mockResolvedValue(pending);
  vi.mocked(completeEnrollment).mockResolvedValue({ status: "complete", destination: "/trial/sucesso?tenant=synthetic" });
  const response = await call("token_hash=synthetic&type=signup");
  expect(verify).toHaveBeenCalledWith({ token_hash: "synthetic", type: "signup" }); expect(completeEnrollment).toHaveBeenCalledWith(pending);
  expect(response.headers.get("location")).toBe("https://vexo.example.test/trial/sucesso?tenant=synthetic"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
});
it("sends confirmed accounts without browser state to the authenticated enrollment form", async () => {
  expect((await call("token_hash=synthetic&type=signup")).headers.get("location")).toBe("https://vexo.example.test/cadastro?confirmed=1");
  expect(completeEnrollment).not.toHaveBeenCalled();
});
