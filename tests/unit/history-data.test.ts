import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * D18.4 (Fase 2) — `features/history/data.ts` consome só a infraestrutura
 * de auditoria já existente (nenhuma escrita, nenhuma tabela nova). Mesmo
 * padrão de mock de `tests/unit/master-audit-data.test.ts` (chain fluente
 * "thenable" para simular o query builder do Supabase), estendido com um
 * `rpc()` mockado para `has_permission` (a checagem de `settings.view`
 * dentro de `resolveTenantWithSettingsView`).
 */
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/features/onboarding/resolve-tenant", () => ({
  resolveActiveTenantForUser: vi.fn(),
}));

import { listHistoryForTenant } from "@/features/history/data";
import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { HISTORY_PAGE_SIZE } from "@/features/history/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const TENANT_ID = "398e7a85-fac2-4bc9-ae1a-c498ea93805f";
const USER_ID = "d4a6c9d2-7f3e-4a4a-9a1a-6c1e9c2a5f10";

interface Calls {
  select: unknown[];
  eq: unknown[][];
  in: unknown[][];
  gte: unknown[][];
  order: unknown[][];
  range: unknown[][];
}

function makeQuery(result: { data: unknown; error: unknown; count?: number | null }, calls: Calls) {
  const chain = {
    select: (...args: unknown[]) => {
      calls.select.push(args[0]);
      return chain;
    },
    eq: (...args: unknown[]) => {
      calls.eq.push(args);
      return chain;
    },
    in: (...args: unknown[]) => {
      calls.in.push(args);
      return chain;
    },
    gte: (...args: unknown[]) => {
      calls.gte.push(args);
      return chain;
    },
    order: (...args: unknown[]) => {
      calls.order.push(args);
      return chain;
    },
    range: (...args: unknown[]) => {
      calls.range.push(args);
      return chain;
    },
    then: (resolve: (v: typeof result) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

interface MockResults {
  audit_logs?: { data: unknown; error: unknown; count?: number | null };
  profiles?: { data: unknown; error: unknown };
  hasPermission?: boolean;
}

let calls: Calls;

function mockSupabase(results: MockResults = {}) {
  calls = { select: [], eq: [], in: [], gte: [], order: [], range: [] };
  const from = vi.fn((table: string) => {
    if (table === "audit_logs") return makeQuery(results.audit_logs ?? { data: [], error: null, count: 0 }, calls);
    if (table === "profiles") return makeQuery(results.profiles ?? { data: [], error: null }, calls);
    throw new Error(`unexpected table in test mock: ${table}`);
  });
  const rpc = vi.fn().mockResolvedValue({ data: results.hasPermission ?? true, error: null });
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ from, rpc } as never);
  return { from, rpc };
}

function mockMembership(overrides: { onboardingCompleted?: boolean } = {}) {
  vi.mocked(resolveActiveTenantForUser).mockResolvedValue({
    tenant: {
      id: TENANT_ID,
      onboarding_completed_at: overrides.onboardingCompleted === false ? null : "2026-01-01T00:00:00.000Z",
    } as never,
    roleKey: "ADMIN",
  });
}

const SYNTHETIC_ROW = {
  id: "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e",
  created_at: "2026-08-30T12:00:00.000Z",
  action: "PRODUCT_UPDATED",
  actor_type: "user",
  actor_user_id: USER_ID,
  resource_type: "product",
  resource_id: "some-product-id",
  before: { price: 1000 },
  after: { price: 1200 },
  metadata: {},
};

describe("listHistoryForTenant (D18.4 Fase 2)", () => {
  afterEach(() => {
    vi.mocked(createSupabaseServerClient).mockReset();
    vi.mocked(resolveActiveTenantForUser).mockReset();
  });

  it("§3 — bloqueia (lança) quando o ator não tem settings.view, mesmo antes de consultar audit_logs", async () => {
    mockMembership();
    const { from } = mockSupabase({ hasPermission: false });

    await expect(listHistoryForTenant({})).rejects.toThrow(/permissão/i);
    expect(from).not.toHaveBeenCalledWith("audit_logs");
  });

  it("bloqueia (lança) quando não há membership ativa/onboarding concluído", async () => {
    vi.mocked(resolveActiveTenantForUser).mockResolvedValue(null);
    mockSupabase();

    await expect(listHistoryForTenant({})).rejects.toThrow();
  });

  it("sempre filtra por tenant_id resolvido da sessão — nunca aceita tenant_id vindo dos filtros (o tipo nem declara esse campo)", async () => {
    mockMembership();
    mockSupabase({ audit_logs: { data: [], error: null, count: 0 } });

    await listHistoryForTenant({ tenantId: "11111111-1111-1111-1111-111111111111" } as never);

    expect(calls.eq).toContainEqual(["tenant_id", TENANT_ID]);
    expect(calls.eq.some(([, value]) => value === "11111111-1111-1111-1111-111111111111")).toBe(false);
  });

  it("ordena por created_at decrescente e pagina via range()", async () => {
    mockMembership();
    mockSupabase({ audit_logs: { data: [], error: null, count: 45 } });

    const page1 = await listHistoryForTenant({ page: 1 });
    expect(calls.order).toContainEqual(["created_at", { ascending: false }]);
    expect(calls.range).toContainEqual([0, HISTORY_PAGE_SIZE - 1]);
    expect(page1.pageCount).toBe(Math.ceil(45 / HISTORY_PAGE_SIZE));

    mockMembership();
    mockSupabase({ audit_logs: { data: [], error: null, count: 45 } });
    await listHistoryForTenant({ page: 3 });
    expect(calls.range).toContainEqual([2 * HISTORY_PAGE_SIZE, 3 * HISTORY_PAGE_SIZE - 1]);
  });

  it("filtro de evento só aplica eq() quando é um HISTORY_ACTIONS real — nunca inventa filtro para valor arbitrário", async () => {
    mockMembership();
    mockSupabase({ audit_logs: { data: [], error: null, count: 0 } });
    await listHistoryForTenant({ action: "PRODUCT_CREATED" });
    expect(calls.eq).toContainEqual(["action", "PRODUCT_CREATED"]);

    mockMembership();
    mockSupabase({ audit_logs: { data: [], error: null, count: 0 } });
    await listHistoryForTenant({ action: "NOT_A_REAL_ACTION" as never });
    expect(calls.eq.some(([col]) => col === "action")).toBe(false);
  });

  it("nunca mostra eventos de escopo Master no catálogo — PLAN_CREATED não é um HISTORY_ACTIONS válido, então o filtro é descartado", async () => {
    mockMembership();
    mockSupabase({ audit_logs: { data: [], error: null, count: 0 } });
    await listHistoryForTenant({ action: "PLAN_CREATED" as never });
    expect(calls.eq.some(([col]) => col === "action")).toBe(false);
  });

  it("filtro de entidade só aplica eq() quando é um HISTORY_ENTITY_TYPES real", async () => {
    mockMembership();
    mockSupabase({ audit_logs: { data: [], error: null, count: 0 } });
    await listHistoryForTenant({ resourceType: "product" });
    expect(calls.eq).toContainEqual(["resource_type", "product"]);

    mockMembership();
    mockSupabase({ audit_logs: { data: [], error: null, count: 0 } });
    await listHistoryForTenant({ resourceType: "not_a_real_entity" as never });
    expect(calls.eq.some(([col]) => col === "resource_type")).toBe(false);
  });

  it("filtro de usuário aplica eq(actor_user_id)", async () => {
    mockMembership();
    mockSupabase({ audit_logs: { data: [], error: null, count: 0 } });
    await listHistoryForTenant({ userId: USER_ID });
    expect(calls.eq).toContainEqual(["actor_user_id", USER_ID]);
  });

  it("filtro de período aplica gte(created_at), nunca filtra no client", async () => {
    mockMembership();
    mockSupabase({ audit_logs: { data: [], error: null, count: 0 } });
    await listHistoryForTenant({ period: "7d" });
    expect(calls.gte).toHaveLength(1);
    expect(calls.gte[0]![0]).toBe("created_at");
  });

  it("resolve o nome do ator (actor_type='user') via profiles", async () => {
    mockMembership();
    mockSupabase({
      audit_logs: { data: [SYNTHETIC_ROW], error: null, count: 1 },
      profiles: { data: [{ id: USER_ID, full_name: "João" }], error: null },
    });

    const result = await listHistoryForTenant({});
    expect(result.logs[0]!.actorName).toBe("João");
  });

  it("§10 — actor_type='system'/'master' NUNCA disparam a busca de profiles, mesmo que actor_user_id venha preenchido por acaso", async () => {
    mockMembership();
    const { from } = mockSupabase({
      audit_logs: {
        data: [
          { ...SYNTHETIC_ROW, id: "row-system", actor_type: "system", actor_user_id: null },
          { ...SYNTHETIC_ROW, id: "row-master", actor_type: "master", actor_user_id: USER_ID },
        ],
        error: null,
        count: 2,
      },
    });

    const result = await listHistoryForTenant({});

    expect(calls.in).toHaveLength(0);
    expect(from).not.toHaveBeenCalledWith("profiles");
    expect(result.logs.find((l) => l.id === "row-system")!.actorName).toBeNull();
    expect(result.logs.find((l) => l.id === "row-master")!.actorName).toBeNull();
  });

  it("profile inexistente/removido: actor_type='user' sem linha correspondente em profiles vira actorName null", async () => {
    mockMembership();
    mockSupabase({
      audit_logs: { data: [SYNTHETIC_ROW], error: null, count: 1 },
      profiles: { data: [], error: null },
    });

    const result = await listHistoryForTenant({});
    expect(result.logs[0]!.actorName).toBeNull();
  });

  it("redige chaves sensíveis dentro de before/after/metadata (reaproveita redactSensitiveJson de features/master/audit-data.ts)", async () => {
    mockMembership();
    mockSupabase({
      audit_logs: {
        data: [
          {
            ...SYNTHETIC_ROW,
            before: { access_token: "should-never-appear", status: "active" },
            after: { webhook_secret: "should-never-appear", status: "suspended" },
            metadata: { client_secret: "should-never-appear", provider: "mercadopago" },
          },
        ],
        error: null,
        count: 1,
      },
      profiles: { data: [], error: null },
    });

    const result = await listHistoryForTenant({});
    const serialized = JSON.stringify(result.logs[0]);

    expect(serialized).not.toContain("should-never-appear");
    expect((result.logs[0]!.before as Record<string, unknown>).access_token).toBe("[redacted]");
    expect((result.logs[0]!.after as Record<string, unknown>).webhook_secret).toBe("[redacted]");
    expect((result.logs[0]!.metadata as Record<string, unknown>).client_secret).toBe("[redacted]");
  });

  it("propaga um erro real do Supabase — nunca vira lista vazia silenciosamente", async () => {
    mockMembership();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockSupabase({ audit_logs: { data: null, error: { message: "connection reset" }, count: null } });

    await expect(listHistoryForTenant({})).rejects.toThrow();
    errorSpy.mockRestore();
  });
});
