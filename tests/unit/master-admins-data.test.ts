import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * D11.3 — `features/master/admins-data.ts` é somente leitura, de
 * propósito: `platform_admins` tem INSERT/UPDATE/DELETE revogados de
 * `anon`/`authenticated`/`service_role` desde a Etapa 2 (ver comentário no
 * próprio data layer e a seção K do relatório final). Mesmo padrão de mock
 * de `tests/unit/master-tenants-data.test.ts`/`master-audit-data.test.ts`
 * (client Supabase fake via `vi.mock`, nunca dado real de produção).
 */
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { countMasters, listPlatformAdmins } from "@/features/master/admins-data";

const USER_MASTER = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";
const USER_SUPPORT = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";

function makeQuery(result: { data: unknown; error: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    then: (resolve: (v: typeof result) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

interface MockResults {
  platform_admins?: { data: unknown; error: unknown };
  profiles?: { data: unknown; error: unknown };
}

function mockSupabase(results: MockResults = {}) {
  const from = vi.fn((table: string) => {
    if (table === "platform_admins") return makeQuery(results.platform_admins ?? { data: [], error: null });
    if (table === "profiles") return makeQuery(results.profiles ?? { data: [], error: null });
    throw new Error(`unexpected table in test mock: ${table}`);
  });
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);
  return { from };
}

describe("features/master/admins-data (D11.3)", () => {
  afterEach(() => {
    vi.mocked(createSupabaseServerClient).mockReset();
  });

  it("caminho feliz: retorna administradores com nome/e-mail resolvidos via profiles", async () => {
    mockSupabase({
      platform_admins: {
        data: [
          { id: "row-1", user_id: USER_MASTER, role: "MASTER", created_at: "2026-01-01T00:00:00.000Z" },
          { id: "row-2", user_id: USER_SUPPORT, role: "SUPPORT_AGENT", created_at: "2026-02-01T00:00:00.000Z" },
        ],
        error: null,
      },
      profiles: {
        data: [
          { id: USER_MASTER, full_name: "Admin Master", email: "master@vexo.test" },
          { id: USER_SUPPORT, full_name: "Agente Suporte", email: "suporte@vexo.test" },
        ],
        error: null,
      },
    });

    const admins = await listPlatformAdmins();

    expect(admins).toHaveLength(2);
    expect(admins[0]).toMatchObject({ userId: USER_MASTER, role: "MASTER", fullName: "Admin Master", email: "master@vexo.test" });
    expect(admins[1]).toMatchObject({ userId: USER_SUPPORT, role: "SUPPORT_AGENT", fullName: "Agente Suporte" });
  });

  it("lista vazia não tenta consultar profiles", async () => {
    const { from } = mockSupabase({ platform_admins: { data: [], error: null } });

    const admins = await listPlatformAdmins();

    expect(admins).toEqual([]);
    expect(from).not.toHaveBeenCalledWith("profiles");
  });

  it("administrador sem profile correspondente (linha órfã improvável) não quebra — nome/e-mail ficam null", async () => {
    mockSupabase({
      platform_admins: {
        data: [{ id: "row-1", user_id: USER_MASTER, role: "MASTER", created_at: "2026-01-01T00:00:00.000Z" }],
        error: null,
      },
      profiles: { data: [], error: null },
    });

    const admins = await listPlatformAdmins();

    expect(admins[0]!.fullName).toBeNull();
    expect(admins[0]!.email).toBeNull();
  });

  it("propaga um erro real do Supabase — nunca vira lista vazia silenciosamente", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockSupabase({ platform_admins: { data: null, error: { message: "connection reset" } } });

    await expect(listPlatformAdmins()).rejects.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("failed to load platform admins"), expect.any(Object));
  });

  it("countMasters conta só MASTER, nunca SUPPORT_AGENT", () => {
    expect(countMasters([{ role: "MASTER" }, { role: "SUPPORT_AGENT" }, { role: "MASTER" }])).toBe(2);
    expect(countMasters([{ role: "SUPPORT_AGENT" }])).toBe(0);
    expect(countMasters([])).toBe(0);
  });
});
