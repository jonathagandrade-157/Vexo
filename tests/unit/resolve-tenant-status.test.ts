import { describe, expect, it } from "vitest";

import { getBlockedTenantStatus, resolveActiveTenantForUser, type OnboardingTenant } from "@/features/onboarding/resolve-tenant";

/**
 * D8 (Camada 1) — `activeMemberships()` (privada) passa a ignorar tenants
 * `suspended`/`deleted` antes de `resolveActiveTenantForUser` decidir
 * qualquer coisa; como as ~18 Server Actions do painel e o próprio
 * `app/painel/layout.tsx` dependem exclusivamente dela, este é o único
 * ponto que precisa de teste direto — nenhuma Server Action foi (ou
 * precisa ser) alterada individualmente.
 *
 * `resolveActiveTenantForUser`/`getBlockedTenantStatus` recebem o client
 * Supabase diretamente como parâmetro (não o resolvem internamente via
 * `createSupabaseServerClient()`), então um client fake simples — sem
 * `vi.mock` — já é suficiente; mesmo princípio de qualquer teste de função
 * pura com dependência injetada.
 */

function tenant(overrides: Partial<OnboardingTenant> & { id: string; status: string }): OnboardingTenant {
  return {
    name: `Loja ${overrides.id}`,
    slug: `loja-${overrides.id}`,
    segment: null,
    description: null,
    instagram_handle: null,
    whatsapp_phone: null,
    contact_email: null,
    onboarding_completed_at: "2026-01-01T00:00:00.000Z",
    business_type: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

interface Row {
  role: { key: string } | null;
  tenant: OnboardingTenant | null;
}

/** Mesma cadeia usada pelo código real: `.from(...).select(...).eq(...).eq(...).order(...)`. */
function makeClient(rows: Row[], userId: string | null = "user-1") {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => Promise.resolve({ data: rows, error: null }),
  };
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: userId ? { id: userId } : null } }) },
    from: () => chain,
  } as never;
}

describe("resolveActiveTenantForUser — D8 Camada 1 (tenant suspenso/deletado)", () => {
  it("1. tenant active continua funcionando normalmente", async () => {
    const client = makeClient([{ role: { key: "OWNER" }, tenant: tenant({ id: "a", status: "active" }) }]);
    const result = await resolveActiveTenantForUser(client);
    expect(result?.tenant.id).toBe("a");
  });

  it("2. tenant pending continua funcionando normalmente (nunca bloqueado por esta regra)", async () => {
    const client = makeClient([{ role: { key: "OWNER" }, tenant: tenant({ id: "a", status: "pending" }) }]);
    const result = await resolveActiveTenantForUser(client);
    expect(result?.tenant.id).toBe("a");
  });

  it("3. tenant suspended é ignorado — resolveActiveTenantForUser retorna null", async () => {
    const client = makeClient([{ role: { key: "OWNER" }, tenant: tenant({ id: "a", status: "suspended" }) }]);
    const result = await resolveActiveTenantForUser(client);
    expect(result).toBeNull();
  });

  it("4. tenant deleted é ignorado — resolveActiveTenantForUser retorna null", async () => {
    const client = makeClient([{ role: { key: "OWNER" }, tenant: tenant({ id: "a", status: "deleted" }) }]);
    const result = await resolveActiveTenantForUser(client);
    expect(result).toBeNull();
  });

  it("5. dois tenants (um suspended, um active) → retorna o active", async () => {
    const client = makeClient([
      { role: { key: "OWNER" }, tenant: tenant({ id: "suspenso", status: "suspended" }) },
      { role: { key: "ADMIN" }, tenant: tenant({ id: "ativo", status: "active" }) },
    ]);
    const result = await resolveActiveTenantForUser(client);
    expect(result?.tenant.id).toBe("ativo");
  });

  it("6. dois tenants (um deleted, um pending) → retorna o pending", async () => {
    const client = makeClient([
      { role: { key: "OWNER" }, tenant: tenant({ id: "deletado", status: "deleted" }) },
      { role: { key: "MANAGER" }, tenant: tenant({ id: "pendente", status: "pending" }) },
    ]);
    const result = await resolveActiveTenantForUser(client);
    expect(result?.tenant.id).toBe("pendente");
  });

  it("7. usuário só com tenant suspended → não é retornado (tratado como sem tenant)", async () => {
    const client = makeClient([{ role: { key: "OWNER" }, tenant: tenant({ id: "a", status: "suspended" }) }]);
    expect(await resolveActiveTenantForUser(client)).toBeNull();
  });

  it("8. usuário só com tenant deleted → não é retornado (tratado como sem tenant)", async () => {
    const client = makeClient([{ role: { key: "OWNER" }, tenant: tenant({ id: "a", status: "deleted" }) }]);
    expect(await resolveActiveTenantForUser(client)).toBeNull();
  });

  it("9. usuário sem nenhum tenant continua retornando null (regressão)", async () => {
    const client = makeClient([]);
    expect(await resolveActiveTenantForUser(client)).toBeNull();
  });

  it("sem sessão (getUser retorna null) continua retornando null (regressão)", async () => {
    const client = makeClient([{ role: { key: "OWNER" }, tenant: tenant({ id: "a", status: "active" }) }], null);
    expect(await resolveActiveTenantForUser(client)).toBeNull();
  });
});

describe("getBlockedTenantStatus — só para a mensagem de UX, nunca para autorização", () => {
  it("retorna 'suspended' quando o (único) tenant do usuário está suspenso", async () => {
    const client = makeClient([{ role: { key: "OWNER" }, tenant: tenant({ id: "a", status: "suspended" }) }]);
    expect(await getBlockedTenantStatus(client)).toBe("suspended");
  });

  it("retorna 'deleted' quando o (único) tenant do usuário está deletado", async () => {
    const client = makeClient([{ role: { key: "OWNER" }, tenant: tenant({ id: "a", status: "deleted" }) }]);
    expect(await getBlockedTenantStatus(client)).toBe("deleted");
  });

  it("retorna null quando não há nenhum tenant bloqueado (nunca usado para liberar acesso)", async () => {
    const client = makeClient([{ role: { key: "OWNER" }, tenant: tenant({ id: "a", status: "active" }) }]);
    expect(await getBlockedTenantStatus(client)).toBeNull();
  });

  it("retorna null sem sessão", async () => {
    const client = makeClient([], null);
    expect(await getBlockedTenantStatus(client)).toBeNull();
  });
});
