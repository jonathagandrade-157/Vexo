import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * D18.3.1 — testa a CAMADA 1 (Server Action) do bloqueio de convite de
 * OWNER: `inviteTeamMemberAction` deve rejeitar `roleKey="OWNER"` ANTES de
 * chamar `inviteUserByEmail` (e portanto antes de criar qualquer
 * `auth.users`) — nunca confiar só no filtro do `<select>` do formulário.
 * A CAMADA 2 (trigger de banco `prevent_unauthorized_owner_insert`) é
 * testada separadamente em `tests/integration/team-management.test.ts`,
 * direto via SQL. Mesmo padrão de mock de
 * `tests/unit/domain-vercel-actions.test.ts`/`domain-verification-actions.test.ts`.
 */
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceRoleClient: vi.fn(),
}));
vi.mock("@/features/onboarding/resolve-tenant", () => ({
  resolveActiveTenantForUser: vi.fn(),
}));
vi.mock("@/lib/env", () => ({
  getPublicEnv: vi.fn(() => ({ NEXT_PUBLIC_SITE_URL: "https://vexoecommerce.vercel.app" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { inviteTeamMemberAction } from "@/features/team/actions";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const ACTOR_USER_ID = "22222222-2222-2222-2222-222222222222";
const INVITED_USER_ID = "33333333-3333-3333-3333-333333333333";
const ROLE_ROW_ID = "44444444-4444-4444-4444-444444444444";

function mockSession(hasTeamManage: boolean) {
  vi.mocked(resolveActiveTenantForUser).mockResolvedValue({
    tenant: { id: TENANT_ID, onboarding_completed_at: "2026-01-01T00:00:00.000Z" } as never,
    roleKey: "ADMIN",
  });
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: ACTOR_USER_ID } } }) },
    rpc: vi.fn().mockResolvedValue({ data: hasTeamManage, error: null }),
  } as never);
}

function mockServiceRoleClient(overrides: {
  inviteUserByEmail?: ReturnType<typeof vi.fn>;
  insert?: ReturnType<typeof vi.fn>;
  roleRow?: { id: string } | null;
} = {}) {
  const inviteUserByEmail =
    overrides.inviteUserByEmail ?? vi.fn().mockResolvedValue({ data: { user: { id: INVITED_USER_ID } }, error: null });
  const insert = overrides.insert ?? vi.fn().mockResolvedValue({ error: null });
  const roleRow = "roleRow" in overrides ? overrides.roleRow : { id: ROLE_ROW_ID };

  const client = {
    auth: { admin: { inviteUserByEmail } },
    from: vi.fn((table: string) => {
      if (table === "roles") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: roleRow, error: null }) }) }),
        };
      }
      if (table === "tenant_members") {
        return { insert };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
  vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);
  return { inviteUserByEmail, insert };
}

function formDataOf(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("inviteTeamMemberAction — bloqueio de OWNER (D18.3.1, CAMADA 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1/2. roleKey=OWNER é rejeitado ANTES de chamar inviteUserByEmail — nunca cria auth.users", async () => {
    mockSession(true);
    const { inviteUserByEmail, insert } = mockServiceRoleClient();

    const result = await inviteTeamMemberAction(
      { status: "idle" },
      formDataOf({ email: "novo-owner@example.com", roleKey: "OWNER" }),
    );

    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/Dono\(a\)/);
  });

  it("mensagem de rejeição de OWNER nunca expõe detalhe técnico (SQLSTATE, nome de trigger)", async () => {
    mockSession(true);
    mockServiceRoleClient();

    const result = await inviteTeamMemberAction({ status: "idle" }, formDataOf({ email: "x@example.com", roleKey: "OWNER" }));

    expect(result.message ?? "").not.toMatch(/23514|42501|prevent_|trigger|postgres/i);
  });

  it("5. convite com roleKey=OPERATOR continua funcionando normalmente", async () => {
    mockSession(true);
    const { inviteUserByEmail, insert } = mockServiceRoleClient();

    const result = await inviteTeamMemberAction(
      { status: "idle" },
      formDataOf({ email: "operador@example.com", roleKey: "OPERATOR" }),
    );

    expect(inviteUserByEmail).toHaveBeenCalledWith("operador@example.com", expect.objectContaining({ redirectTo: expect.any(String) }));
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: TENANT_ID,
        user_id: INVITED_USER_ID,
        role_id: ROLE_ROW_ID,
        status: "invited",
        invited_by: ACTOR_USER_ID,
      }),
    );
    expect(result.status).toBe("success");
  });

  it("6. convite com roleKey=ADMIN continua funcionando (não é bloqueado — só OWNER é)", async () => {
    mockSession(true);
    const { inviteUserByEmail } = mockServiceRoleClient();

    const result = await inviteTeamMemberAction({ status: "idle" }, formDataOf({ email: "admin@example.com", roleKey: "ADMIN" }));

    expect(inviteUserByEmail).toHaveBeenCalled();
    expect(result.status).toBe("success");
  });

  it("ator sem team.manage é bloqueado antes de qualquer chamada ao Supabase, mesmo tentando convidar um papel não-OWNER", async () => {
    mockSession(false);
    const { inviteUserByEmail } = mockServiceRoleClient();

    const result = await inviteTeamMemberAction({ status: "idle" }, formDataOf({ email: "x@example.com", roleKey: "OPERATOR" }));

    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/permissão/i);
  });

  it("20. tenant_id/user_id enviados pelo formulário (campos que o schema nem declara) são ignorados — sempre resolvidos da sessão", async () => {
    mockSession(true);
    const { insert } = mockServiceRoleClient();

    await inviteTeamMemberAction(
      { status: "idle" },
      formDataOf({
        email: "operador@example.com",
        roleKey: "OPERATOR",
        tenantId: "99999999-9999-9999-9999-999999999999",
        userId: "88888888-8888-8888-8888-888888888888",
      }),
    );

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: TENANT_ID, invited_by: ACTOR_USER_ID }),
    );
    expect(insert).not.toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: "99999999-9999-9999-9999-999999999999" }),
    );
  });

  it("e-mail já existente retorna erro claro, sem tentar inserir tenant_members", async () => {
    mockSession(true);
    const { insert } = mockServiceRoleClient({
      inviteUserByEmail: vi.fn().mockResolvedValue({ data: { user: null }, error: { code: "email_exists", message: "already registered" } }),
    });

    const result = await inviteTeamMemberAction({ status: "idle" }, formDataOf({ email: "existente@example.com", roleKey: "OPERATOR" }));

    expect(insert).not.toHaveBeenCalled();
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/já possui uma conta/i);
  });
});
