import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ TRIAL_HASH_SECRET: "placeholder-trial-hash-secret-not-real" }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }) }));
vi.mock("@/lib/security/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/rate-limit")>()),
  checkRateLimit: vi.fn(),
}));

import { AUTH_RATE_LIMITS, isAuthAttemptLimited, isDisposableBrowserLab } from "@/features/auth/rate-limit";
import { checkRateLimit } from "@/lib/security/rate-limit";

const allowed = { allowed: true, retryAfterSeconds: 0 };
const denied = { allowed: false, retryAfterSeconds: 30 };

beforeEach(() => {
  vi.mocked(checkRateLimit).mockReset();
});

describe("auth rate limit", () => {
  it("conta por IP do visitante e por HMAC do e-mail, nunca o e-mail em claro", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(allowed);
    expect(await isAuthAttemptLimited("sign_in", "  Pessoa@Example.com ")).toBe(false);
    const keys = vi.mocked(checkRateLimit).mock.calls.map(([key]) => key);
    expect(keys).toContain("auth:sign_in:ip:203.0.113.7");
    const emailKey = keys.find((key) => key.startsWith("auth:sign_in:email:"))!;
    expect(emailKey).not.toMatch(/pessoa|example/i);
    // Normalização: mesma conta, mesma chave.
    vi.mocked(checkRateLimit).mockClear();
    await isAuthAttemptLimited("sign_in", "pessoa@example.com");
    expect(vi.mocked(checkRateLimit).mock.calls.map(([key]) => key)).toContain(emailKey);
  });

  it.each([
    ["IP", [denied, allowed]],
    ["e-mail", [allowed, denied]],
  ] as const)("recusa quando o limite por %s estoura", async (_label, [ip, email]) => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce(ip).mockResolvedValueOnce(email);
    expect(await isAuthAttemptLimited("password_reset", "a@b.co")).toBe(true);
  });

  it("login falha aberto quando o contador está indisponível; cadastro, reenvio e recuperação falham fechados", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(null);
    expect(await isAuthAttemptLimited("sign_in", "a@b.co")).toBe(false);
    expect(await isAuthAttemptLimited("sign_up", "a@b.co")).toBe(true);
    expect(await isAuthAttemptLimited("resend_confirmation", "a@b.co")).toBe(true);
    expect(await isAuthAttemptLimited("password_reset", "a@b.co")).toBe(true);

    // Exceção do cliente (ex.: variável ausente ao criar o cliente administrativo).
    vi.mocked(checkRateLimit).mockImplementation(() => {
      throw new Error("network");
    });
    expect(await isAuthAttemptLimited("sign_in", "a@b.co")).toBe(false);
    expect(await isAuthAttemptLimited("sign_up", "a@b.co")).toBe(true);

    vi.mocked(checkRateLimit).mockRejectedValue(new Error("timeout"));
    expect(await isAuthAttemptLimited("sign_in", "a@b.co")).toBe(false);
    expect(await isAuthAttemptLimited("password_reset", "a@b.co")).toBe(true);
  });

  it("usa as janelas e limites declarados", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(allowed);
    await isAuthAttemptLimited("sign_up", "a@b.co");
    for (const [, windowSeconds, max] of vi.mocked(checkRateLimit).mock.calls) {
      expect(windowSeconds).toBe(AUTH_RATE_LIMITS.sign_up.windowSeconds);
      expect([AUTH_RATE_LIMITS.sign_up.perIp, AUTH_RATE_LIMITS.sign_up.perEmail]).toContain(max);
    }
  });

  it("a dispensa do laboratório exige CI + marcador + Supabase em loopback, e nunca vale na Vercel", () => {
    const lab = { CI: "true", E2E_ISOLATED_SUPABASE: "1", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" };
    expect(isDisposableBrowserLab(lab)).toBe(true);
    expect(isDisposableBrowserLab({ ...lab, CI: undefined })).toBe(false);
    expect(isDisposableBrowserLab({ ...lab, E2E_ISOLATED_SUPABASE: undefined })).toBe(false);
    expect(isDisposableBrowserLab({ ...lab, NEXT_PUBLIC_SUPABASE_URL: "https://vqbiurnfqkjkrenigxzv.supabase.co" })).toBe(false);
    expect(isDisposableBrowserLab({ ...lab, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321.evil.example" })).toBe(false);
    expect(isDisposableBrowserLab({ ...lab, VERCEL: "1" })).toBe(false);
  });
});
