import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Etapa 19 — testa só a lógica de decisão de `resolvePostLoginDestination`
 * (a peça nova desta etapa), mockando as duas fontes já existentes e já
 * testadas em outro lugar (`getCurrentPlatformAdmin` via RLS/platform_admins
 * em commercial-foundation.test.ts/master-tenants.test.ts;
 * `getCurrentMembership`/`resolveActiveTenantForUser` via
 * rls-isolation.test.ts/painel.test.ts). Este arquivo nunca reimplementa
 * ou reverifica essas fontes — só garante que o dispatcher combina os
 * resultados delas na ordem e nas condições certas.
 */

const getCurrentPlatformAdmin = vi.fn();
const getCurrentMembership = vi.fn();

vi.mock("@/features/master/current-admin", () => ({
  getCurrentPlatformAdmin: (...args: unknown[]) => getCurrentPlatformAdmin(...args),
}));

vi.mock("@/features/painel/current-tenant", () => ({
  getCurrentMembership: (...args: unknown[]) => getCurrentMembership(...args),
}));

describe("resolvePostLoginDestination", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("MASTER goes to /master, without even checking membership", async () => {
    getCurrentPlatformAdmin.mockResolvedValue({ userId: "u1", role: "MASTER" });

    const { resolvePostLoginDestination } = await import("@/features/auth/post-login-destination");
    await expect(resolvePostLoginDestination()).resolves.toBe("/master");
    expect(getCurrentMembership).not.toHaveBeenCalled();
  });

  it("SUPPORT_AGENT goes to /master, even without any tenant", async () => {
    getCurrentPlatformAdmin.mockResolvedValue({ userId: "u2", role: "SUPPORT_AGENT" });
    getCurrentMembership.mockResolvedValue(null);

    const { resolvePostLoginDestination } = await import("@/features/auth/post-login-destination");
    await expect(resolvePostLoginDestination()).resolves.toBe("/master");
  });

  it("authenticated user with no tenant goes to /cadastro", async () => {
    getCurrentPlatformAdmin.mockResolvedValue(null);
    getCurrentMembership.mockResolvedValue(null);

    const { resolvePostLoginDestination } = await import("@/features/auth/post-login-destination");
    await expect(resolvePostLoginDestination()).resolves.toBe("/cadastro");
  });

  it("OWNER with pending onboarding goes to /onboarding", async () => {
    getCurrentPlatformAdmin.mockResolvedValue(null);
    getCurrentMembership.mockResolvedValue({
      roleKey: "OWNER",
      tenant: { onboarding_completed_at: null },
    });

    const { resolvePostLoginDestination } = await import("@/features/auth/post-login-destination");
    await expect(resolvePostLoginDestination()).resolves.toBe("/onboarding");
  });

  it("OWNER with completed onboarding goes to /painel", async () => {
    getCurrentPlatformAdmin.mockResolvedValue(null);
    getCurrentMembership.mockResolvedValue({
      roleKey: "OWNER",
      tenant: { onboarding_completed_at: "2026-01-01T00:00:00Z" },
    });

    const { resolvePostLoginDestination } = await import("@/features/auth/post-login-destination");
    await expect(resolvePostLoginDestination()).resolves.toBe("/painel");
  });

  it("a non-OWNER member (e.g. ADMIN) with pending onboarding still goes to /painel — mirrors app/painel/layout.tsx, which never sends a non-OWNER to /onboarding", async () => {
    getCurrentPlatformAdmin.mockResolvedValue(null);
    getCurrentMembership.mockResolvedValue({
      roleKey: "ADMIN",
      tenant: { onboarding_completed_at: null },
    });

    const { resolvePostLoginDestination } = await import("@/features/auth/post-login-destination");
    await expect(resolvePostLoginDestination()).resolves.toBe("/painel");
  });
});
