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

/**
 * Chain fluente e "thenable" (como o PostgrestFilterBuilder real): qualquer
 * método intermediário devolve a própria chain, e `await chain` resolve
 * `result` diretamente — cobre tanto o caso terminado por `.maybeSingle()`
 * quanto o caso em que o próprio builder é aguardado (ex.: `await query`
 * em `listTenantsForMaster`). D11.4 estende com `.range()`/`.or()`/
 * `.ilike()` (busca/paginação) e registra as chamadas de cada um para as
 * novas asserções, sem alterar o comportamento das chamadas já existentes.
 */
function makeQuery(result: { data: unknown; error: unknown; count?: number | null }) {
  const chain = {
    select: (...args: unknown[]) => {
      selectCalls.push(args[0] as string);
      return chain;
    },
    eq: (...args: unknown[]) => {
      eqCalls.push(args as [string, unknown]);
      return chain;
    },
    in: () => chain,
    ilike: (...args: unknown[]) => {
      ilikeCalls.push(args as [string, string]);
      return chain;
    },
    or: (...args: unknown[]) => {
      orCalls.push(args[0] as string);
      return chain;
    },
    order: () => chain,
    range: (...args: unknown[]) => {
      rangeCalls.push(args as [number, number]);
      return chain;
    },
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: typeof result) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

let selectCalls: string[] = [];
let eqCalls: [string, unknown][] = [];
let ilikeCalls: [string, string][] = [];
let orCalls: string[] = [];
let rangeCalls: [number, number][] = [];

interface MockResults {
  tenants?: { data: unknown; error: unknown; count?: number | null };
  tenant_members?: { data: unknown; error: unknown };
  profiles?: { data: unknown; error: unknown };
}

function mockSupabase(results: MockResults = {}) {
  const from = vi.fn((table: string) => {
    if (table === "tenants") return makeQuery(results.tenants ?? { data: [], error: null, count: 0 });
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
    eqCalls = [];
    ilikeCalls = [];
    orCalls = [];
    rangeCalls = [];
  });

  it("listTenantsForMaster consegue retornar lojas (caminho feliz, embed desambiguado)", async () => {
    mockSupabase({ tenants: { data: [SYNTHETIC_TENANT_ROW], error: null, count: 1 } });

    const result = await listTenantsForMaster();

    expect(result.total).toBe(1);
    expect(result.tenants).toHaveLength(1);
    expect(result.tenants[0]).toMatchObject({ id: TENANT_ID, name: "JA multimarcas", planName: "Básico" });
  });

  it("listTenantsForMaster desambigua o embed de subscriptions→plans pela FK do plano ATUAL, nunca pending_plan_id", async () => {
    mockSupabase({ tenants: { data: [], error: null, count: 0 } });

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
});

/**
 * D11.4 — busca (nome/slug/e-mail do proprietário) e paginação real no
 * banco de `listTenantsForMaster`. Mesmo mock/chain de acima, describe
 * separado só por organização (mesmo arquivo, mesmo `vi.mock` de topo).
 */
describe("features/master/tenants-data — busca e paginação (D11.4)", () => {
  afterEach(() => {
    vi.mocked(createSupabaseServerClient).mockReset();
    selectCalls = [];
    eqCalls = [];
    ilikeCalls = [];
    orCalls = [];
    rangeCalls = [];
  });

  it("busca por nome/slug aplica um único .or() ilike na query principal, nunca busca tudo para filtrar depois", async () => {
    mockSupabase({ tenants: { data: [], error: null, count: 0 } });

    await listTenantsForMaster({ q: "multimarcas" });

    expect(orCalls).toHaveLength(1);
    expect(orCalls[0]).toContain("name.ilike.%multimarcas%");
    expect(orCalls[0]).toContain("slug.ilike.%multimarcas%");
  });

  it("busca por e-mail do proprietário resolve tenant_id via profiles→tenant_members e inclui no mesmo .or()", async () => {
    mockSupabase({
      tenants: { data: [], error: null, count: 0 },
      profiles: { data: [{ id: "user-owner-1" }], error: null },
      tenant_members: {
        data: [{ tenant_id: TENANT_ID, role: { key: "OWNER" } }],
        error: null,
      },
    });

    await listTenantsForMaster({ q: "dono@example.com" });

    expect(ilikeCalls).toContainEqual(["email", "%dono@example.com%"]);
    expect(orCalls[0]).toContain(`id.in.(${TENANT_ID})`);
  });

  it("e-mail que não corresponde a nenhum OWNER não adiciona id.in() vazio ao .or()", async () => {
    mockSupabase({
      tenants: { data: [], error: null, count: 0 },
      profiles: { data: [{ id: "user-x" }], error: null },
      tenant_members: { data: [{ tenant_id: "some-tenant", role: { key: "ADMIN" } }], error: null },
    });

    await listTenantsForMaster({ q: "naoedono@example.com" });

    expect(orCalls[0]).not.toContain("id.in.");
  });

  it("busca combinada (nome/slug OU e-mail do proprietário) nunca perde nenhuma das três dimensões", async () => {
    mockSupabase({
      tenants: { data: [], error: null, count: 0 },
      profiles: { data: [{ id: "user-owner-2" }], error: null },
      tenant_members: { data: [{ tenant_id: "tenant-abc", role: { key: "OWNER" } }], error: null },
    });

    await listTenantsForMaster({ q: "abc" });

    expect(orCalls[0]).toContain("name.ilike.%abc%");
    expect(orCalls[0]).toContain("slug.ilike.%abc%");
    expect(orCalls[0]).toContain("id.in.(tenant-abc)");
  });

  it("busca vazia (string em branco) não aplica .or() nenhum", async () => {
    mockSupabase({ tenants: { data: [], error: null, count: 0 } });

    await listTenantsForMaster({ q: "   " });

    expect(orCalls).toHaveLength(0);
  });

  it("filtro de status continua aplicado via .eq() junto da busca (AND entre status e o OR de busca)", async () => {
    mockSupabase({ tenants: { data: [], error: null, count: 0 } });

    await listTenantsForMaster({ status: "active", q: "loja" });

    expect(eqCalls).toContainEqual(["status", "active"]);
    expect(orCalls[0]).toContain("name.ilike.%loja%");
  });

  it("paginação: primeira página usa range(0, 19)", async () => {
    mockSupabase({ tenants: { data: [], error: null, count: 0 } });

    await listTenantsForMaster({ page: 1 });

    expect(rangeCalls).toContainEqual([0, 19]);
  });

  it("paginação: página intermediária usa o range correto e pageCount reflete o total", async () => {
    mockSupabase({ tenants: { data: [], error: null, count: 45 } });

    const result = await listTenantsForMaster({ page: 3 });

    expect(rangeCalls).toContainEqual([40, 59]);
    expect(result.page).toBe(3);
    expect(result.pageCount).toBe(3); // ceil(45/20)
  });

  it("paginação: página/valor inválido (0, negativo, não numérico) nunca quebra — sempre cai para page=1", async () => {
    mockSupabase({ tenants: { data: [], error: null, count: 0 } });
    await listTenantsForMaster({ page: 0 });
    expect(rangeCalls).toContainEqual([0, 19]);

    rangeCalls = [];
    mockSupabase({ tenants: { data: [], error: null, count: 0 } });
    await listTenantsForMaster({ page: -5 });
    expect(rangeCalls).toContainEqual([0, 19]);
  });

  it("resultado vazio (nenhuma loja corresponde) retorna tenants=[] e total/pageCount corretos, sem consultar tenant_members/profiles", async () => {
    const { from } = mockSupabase({ tenants: { data: [], error: null, count: 0 } });

    const result = await listTenantsForMaster({ q: "inexistente" });

    expect(result.tenants).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.pageCount).toBe(1);
    // profiles não encontrou nenhum e-mail correspondente → resolveOwnerMatchTenantIds
    // nem chega a consultar tenant_members (curto-circuito); e como o resultado
    // principal também é vazio, a resolução de proprietário PARA EXIBIÇÃO
    // (a segunda leitura de tenant_members, mais abaixo na função) também não roda.
    const tenantMembersCalls = from.mock.calls.filter(([table]) => table === "tenant_members").length;
    expect(tenantMembersCalls).toBe(0);
  });

  it("erro real do Supabase na busca/paginação propaga — nunca vira lista vazia silenciosamente", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockSupabase({ tenants: { data: null, error: { message: "timeout" }, count: null } });

    await expect(listTenantsForMaster({ q: "loja", page: 2 })).rejects.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("failed to load tenants"), expect.any(Object));
  });

  it("regressão: o embed de subscriptions→plans continua desambiguado mesmo com busca/paginação ativas", async () => {
    mockSupabase({ tenants: { data: [SYNTHETIC_TENANT_ROW], error: null, count: 1 } });

    const result = await listTenantsForMaster({ status: "active", q: "multimarcas", page: 1 });

    expect(result.tenants[0]).toMatchObject({ id: TENANT_ID, planName: "Básico" });
    const tenantsSelect = selectCalls.find((s) => s.includes("subscriptions"));
    expect(tenantsSelect).toContain("plans!subscriptions_plan_id_fkey");
    expect(tenantsSelect).not.toContain("pending_plan_id");
  });
});

describe("features/master/tenants-data — getTenantDetailForMaster (inalterado no D11.4)", () => {
  afterEach(() => {
    vi.mocked(createSupabaseServerClient).mockReset();
    selectCalls = [];
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
