import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * D11.2 — `features/master/audit-data.ts` consome só a infraestrutura de
 * auditoria já existente (nenhuma escrita, nenhuma tabela nova). Mesmo
 * padrão de mock de `tests/unit/master-tenants-data.test.ts` (client
 * Supabase fake via `vi.mock`, nunca uma segunda implementação de leitura,
 * nenhum dado real de produção).
 */
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AUDIT_PAGE_SIZE, listAuditLogsForMaster } from "@/features/master/audit-data";

const TENANT_ID = "398e7a85-fac2-4bc9-ae1a-c498ea93805f";
const USER_ID = "d4a6c9d2-7f3e-4a4a-9a1a-6c1e9c2a5f10";

interface Calls {
  select: unknown[];
  eq: unknown[][];
  in: unknown[][];
  gte: unknown[][];
  or: unknown[][];
  order: unknown[][];
  range: unknown[][];
}

/** Chain fluente e "thenable" — mesmo princípio de `makeQuery` em master-tenants-data.test.ts, estendido com `.gte()`/`.or()`/`.range()`, usados por `listAuditLogsForMaster`. */
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
    or: (...args: unknown[]) => {
      calls.or.push(args);
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
}

let calls: Calls;

function mockSupabase(results: MockResults = {}) {
  calls = { select: [], eq: [], in: [], gte: [], or: [], order: [], range: [] };
  const from = vi.fn((table: string) => {
    if (table === "audit_logs") return makeQuery(results.audit_logs ?? { data: [], error: null, count: 0 }, calls);
    if (table === "profiles") return makeQuery(results.profiles ?? { data: [], error: null }, calls);
    throw new Error(`unexpected table in test mock: ${table}`);
  });
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);
  return { from };
}

const SYNTHETIC_LOG_ROW = {
  id: "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e",
  created_at: "2026-08-30T12:00:00.000Z",
  action: "TENANT_STATUS_CHANGED",
  actor_type: "master",
  actor_user_id: USER_ID,
  tenant_id: TENANT_ID,
  resource_type: "tenant",
  resource_id: TENANT_ID,
  reason: null,
  before: { status: "active" },
  after: { status: "suspended" },
  metadata: {},
  tenants: { name: "Loja Teste", slug: "loja-teste" },
};

describe("features/master/audit-data (D11.2)", () => {
  afterEach(() => {
    vi.mocked(createSupabaseServerClient).mockReset();
  });

  it("caminho feliz: retorna logs reais com ator e loja resolvidos", async () => {
    mockSupabase({
      audit_logs: { data: [SYNTHETIC_LOG_ROW], error: null, count: 1 },
      profiles: { data: [{ id: USER_ID, full_name: "Admin VEXO", email: "admin@vexo.test" }], error: null },
    });

    const result = await listAuditLogsForMaster({});

    expect(result.total).toBe(1);
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]).toMatchObject({
      id: SYNTHETIC_LOG_ROW.id,
      action: "TENANT_STATUS_CHANGED",
      actorName: "Admin VEXO",
      actorEmail: "admin@vexo.test",
      tenantName: "Loja Teste",
      resourceType: "tenant",
      resourceId: TENANT_ID,
    });
  });

  it("ordena por created_at decrescente", async () => {
    mockSupabase({ audit_logs: { data: [], error: null, count: 0 } });

    await listAuditLogsForMaster({});

    expect(calls.order).toContainEqual(["created_at", { ascending: false }]);
  });

  it("pagina no banco via range(), nunca busca tudo e pagina no client", async () => {
    mockSupabase({ audit_logs: { data: [], error: null, count: 45 } });

    const page1 = await listAuditLogsForMaster({ page: 1 });
    expect(calls.range).toContainEqual([0, AUDIT_PAGE_SIZE - 1]);
    expect(page1.pageCount).toBe(Math.ceil(45 / AUDIT_PAGE_SIZE));

    mockSupabase({ audit_logs: { data: [], error: null, count: 45 } });
    await listAuditLogsForMaster({ page: 3 });
    expect(calls.range).toContainEqual([2 * AUDIT_PAGE_SIZE, 3 * AUDIT_PAGE_SIZE - 1]);
  });

  it("filtro de evento só é aplicado quando o valor é um AUDIT_ACTIONS real — nunca inventa um filtro para um valor arbitrário", async () => {
    mockSupabase({ audit_logs: { data: [], error: null, count: 0 } });
    await listAuditLogsForMaster({ action: "TENANT_STATUS_CHANGED" });
    expect(calls.eq).toContainEqual(["action", "TENANT_STATUS_CHANGED"]);

    mockSupabase({ audit_logs: { data: [], error: null, count: 0 } });
    await listAuditLogsForMaster({ action: "NOT_A_REAL_ACTION" });
    expect(calls.eq.some(([col]) => col === "action")).toBe(false);
  });

  it("filtro de período aplica gte(created_at) no banco, nunca filtra no client", async () => {
    mockSupabase({ audit_logs: { data: [], error: null, count: 0 } });
    await listAuditLogsForMaster({ period: "7d" });
    expect(calls.gte).toHaveLength(1);
    expect(calls.gte[0]![0]).toBe("created_at");
  });

  it("busca textual aplica or() sobre resource_id/reason/action, nunca sobre before/after/metadata", async () => {
    mockSupabase({ audit_logs: { data: [], error: null, count: 0 } });
    await listAuditLogsForMaster({ q: "tenant" });
    expect(calls.or).toHaveLength(1);
    const orExpr = calls.or[0]![0] as string;
    expect(orExpr).toContain("resource_id.ilike");
    expect(orExpr).toContain("reason.ilike");
    expect(orExpr).toContain("action.ilike");
    expect(orExpr).not.toContain("before");
    expect(orExpr).not.toContain("after");
    expect(orExpr).not.toContain("metadata");
  });

  it("propaga um erro real do Supabase — nunca vira lista vazia silenciosamente", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockSupabase({ audit_logs: { data: null, error: { message: "connection reset" }, count: null } });

    await expect(listAuditLogsForMaster({})).rejects.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("failed to load audit logs"), expect.any(Object));
  });

  it("redige chaves sensíveis dentro de before/after/metadata, mesmo que nenhum trigger real grave isso hoje", async () => {
    mockSupabase({
      audit_logs: {
        data: [
          {
            ...SYNTHETIC_LOG_ROW,
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

    const result = await listAuditLogsForMaster({});
    const serialized = JSON.stringify(result.logs[0]);

    expect(serialized).not.toContain("should-never-appear");
    expect((result.logs[0]!.before as Record<string, unknown>).access_token).toBe("[redacted]");
    expect((result.logs[0]!.after as Record<string, unknown>).webhook_secret).toBe("[redacted]");
    expect((result.logs[0]!.metadata as Record<string, unknown>).client_secret).toBe("[redacted]");
    // campos não sensíveis continuam visíveis normalmente
    expect((result.logs[0]!.metadata as Record<string, unknown>).provider).toBe("mercadopago");
  });

  it("evento sem ator (actor_type='system', actor_user_id null) não tenta resolver perfil", async () => {
    mockSupabase({
      audit_logs: {
        data: [{ ...SYNTHETIC_LOG_ROW, actor_user_id: null, actor_type: "system", tenants: null, tenant_id: null }],
        error: null,
        count: 1,
      },
    });

    const result = await listAuditLogsForMaster({});

    expect(result.logs[0]!.actorUserId).toBeNull();
    expect(result.logs[0]!.actorName).toBeNull();
    expect(result.logs[0]!.tenantName).toBeNull();
  });
});
