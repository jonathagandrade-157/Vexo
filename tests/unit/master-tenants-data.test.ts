import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * D3.2-B Ponto 2F.4 — regressão do bug de embed ambíguo do PostgREST em
 * `features/master/tenants-data.ts`: `subscriptions` tem duas FKs para
 * `plans` (`plan_id` e `pending_plan_id`), então `subscriptions(plans(...))`
 * sem desambiguação falhava com PGRST201 para a query inteira — e como o
 * `error` era descartado, a página `/master/lojas` mostrava "0 lojas" e
 * `/master/lojas/[id]` caía em `notFound()`, mesmo com tenants reais no
 * banco. Mesmo padrão de mock de `tests/unit/whatsapp-order-link.test.ts`
 * (client Supabase mockado via `vi.mock`, nunca uma segunda implementação
 * de leitura; nenhum dado real de produção).
 */
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTenantDetailForMaster, listTenantsForMaster } from "@/features/master/tenants-data";

const TENANT_ID = "398e7a85-fac2-4bc9-ae1a-c498ea93805f";
const PLAN_ID = "7008b8d3-d523-46c7-94c4-6232b7d28053";

/** Chain fluente e "thenable" (como o PostgrestFilterBuilder real): qualquer método intermediário devolve a própria chain, e `await chain` resolve `result` diretamente — cobre tanto o caso terminado por `.maybeSingle()` quanto o caso em que o próprio builder é aguardado (ex.: `await query` em `listTenantsForMaster`). */
function makeQuery(result: { data: unknown; error: unknown }) {
  const chain = {
    select: (...args: unknown[]) => {
      selectCalls.push(args[0] as string);
      return chain;
    },
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: typeof result) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

let selectCalls: string[] = [];

interface MockResults {
  tenants?: { data: unknown; error: unknown };
  tenant_members?: { data: unknown; error: unknown };
  profiles?: { data: unknown; error: unknown };
}

function mockSupabase(results: MockResults = {}) {
  const from = vi.fn((table: string) => {
    if (table === "tenants") return makeQuery(results.tenants ?? { data: [], error: null });
    if (table === "tenant_members") return makeQuery(results.tenant_members ?? { data: [], error: null });
    if (table === "profiles") return makeQuery(results.profiles ?? { data: [], error: null });
    throw new Error(`unexpected table in test mock: ${table}`);
  });
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);
  return { from };
}

const SYNTHETIC_TENANT_ROW = {
  id: TENANT_ID,
  name: "JA multimarcas",
  slug: "ja-multimarcas",
  segment: null,
  status: "pending",
  created_at: "2026-08-26T00:00:00.000Z",
  trial_records: { status: "active", ends_at: "2026-09-23T00:00:00.000Z" },
  subscriptions: { plans: { name: "Básico" } },
};

const SYNTHETIC_TENANT_DETAIL_ROW = {
  ...SYNTHETIC_TENANT_ROW,
  onboarding_completed_at: "2026-08-26T16:54:33.591Z",
  subscriptions: {
    id: "9d853013-7f22-43a1-801f-43b1dd73d34c",
    plan_id: PLAN_ID,
    status: "trialing",
    trial_end: "2026-09-23T00:00:00.000Z",
    current_period_end: null,
    plans: { name: "Intermediário", slug: "intermediate", monthly_price: null, yearly_price: null },
  },
};

describe("features/master/tenants-data (D3.2-B Ponto 2F.4)", () => {
  afterEach(() => {
    vi.mocked(createSupabaseServerClient).mockReset();
    selectCalls = [];
  });

  it("listTenantsForMaster consegue retornar lojas (caminho feliz, embed desambiguado)", async () => {
    mockSupabase({ tenants: { data: [SYNTHETIC_TENANT_ROW], error: null } });

    const tenants = await listTenantsForMaster();

    expect(tenants).toHaveLength(1);
    expect(tenants[0]).toMatchObject({ id: TENANT_ID, name: "JA multimarcas", planName: "Básico" });
  });

  it("listTenantsForMaster desambigua o embed de subscriptions→plans pela FK do plano ATUAL, nunca pending_plan_id", async () => {
    mockSupabase({ tenants: { data: [], error: null } });

    await listTenantsForMaster();

    const tenantsSelect = selectCalls.find((s) => s.includes("subscriptions"));
    expect(tenantsSelect).toContain("plans!subscriptions_plan_id_fkey");
    expect(tenantsSelect).not.toContain("pending_plan_id");
  });

  it("listTenantsForMaster propaga um erro real do Supabase — nunca vira [] silenciosamente", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockSupabase({
      tenants: { data: null, error: { message: "more than one relationship was found", code: "PGRST201" } },
    });

    await expect(listTenantsForMaster()).rejects.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("failed to load tenants"), expect.any(Object));
  });

  it("getTenantDetailForMaster consegue retornar uma loja (caminho feliz)", async () => {
    mockSupabase({ tenants: { data: SYNTHETIC_TENANT_DETAIL_ROW, error: null } });

    const tenant = await getTenantDetailForMaster(TENANT_ID);

    expect(tenant).not.toBeNull();
    expect(tenant!.id).toBe(TENANT_ID);
  });

  it("getTenantDetailForMaster expõe o plano atual a partir de subscriptions.plan_id (nunca pending_plan_id)", async () => {
    mockSupabase({ tenants: { data: SYNTHETIC_TENANT_DETAIL_ROW, error: null } });

    const tenant = await getTenantDetailForMaster(TENANT_ID);

    expect(tenant!.subscription).not.toBeNull();
    expect(tenant!.subscription!.planId).toBe(PLAN_ID);
    expect(tenant!.subscription!.planName).toBe("Intermediário");

    const detailSelect = selectCalls.find((s) => s.includes("subscriptions"));
    expect(detailSelect).toContain("plans!subscriptions_plan_id_fkey");
    expect(detailSelect).not.toContain("pending_plan_id");
  });

  it("getTenantDetailForMaster: tenant_id inexistente (sem erro, sem linha) continua retornando null — comportamento de notFound() preservado", async () => {
    mockSupabase({ tenants: { data: null, error: null } });

    const tenant = await getTenantDetailForMaster(TENANT_ID);

    expect(tenant).toBeNull();
  });

  it("getTenantDetailForMaster propaga um erro real do Supabase — nunca vira null silenciosamente (não pode ser confundido com 'tenant não existe')", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockSupabase({
      tenants: { data: null, error: { message: "more than one relationship was found", code: "PGRST201" } },
    });

    await expect(getTenantDetailForMaster(TENANT_ID)).rejects.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("failed to load tenant"), expect.any(Object));
  });
});
