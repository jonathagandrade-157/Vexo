import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * D17.4.1 — testa `resolveTenantByHost` isoladamente: mocka
 * `createSupabasePublicClient` (mesmo padrão de
 * `tests/unit/melhor-envio-cart-products.test.ts`) para exercitar o código
 * real da função sem tocar Postgres. RLS/policy em si (o que `anon`
 * consegue ou não ler de verdade) já é coberto pelos testes de integração
 * existentes de `tenant_domains`/`tenants` — este arquivo garante que o
 * CÓDIGO da função aplica a regra de elegibilidade explícita (D17.4.0 §N):
 * `tenant_domains.status = 'active'` E `tenants.status = 'active'`, nunca
 * herdada da policy pública (que também aceita `pending`).
 */
vi.mock("@/lib/supabase/server", () => ({ createSupabasePublicClient: vi.fn() }));

import { resolveTenantByHost } from "@/features/storefront/resolve-tenant-by-host";
import { createSupabasePublicClient } from "@/lib/supabase/server";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

interface Response {
  data: unknown;
  error?: unknown;
}

/**
 * `resolveTenantByHost` faz exatamente 2 chamadas `.from()` em sequência
 * (tenant_domains, depois tenants) quando o domínio é encontrado, ou só 1
 * quando não é — cada `.from()` consome a próxima resposta enfileirada,
 * mesmo padrão de `makeServiceRoleClient` em
 * `tests/unit/domain-verification-actions.test.ts`. Registra os filtros
 * `.eq(...)` aplicados em cada chamada para provar que a query usa
 * exatamente os valores esperados (host recebido, status='active').
 */
function fakeSupabase(responses: Response[]) {
  let call = 0;
  const eqCalls: { table: string; filters: [string, unknown][] }[] = [];
  const mutationCalls: string[] = [];
  const from = vi.fn((table: string) => {
    const response = responses[call] ?? { data: null, error: null };
    call += 1;
    const filters: [string, unknown][] = [];
    const record = { table, filters };
    eqCalls.push(record);
    const mutate = (name: string) => () => {
      mutationCalls.push(name);
      throw new Error(`resolveTenantByHost never mutates data — unexpected call to .${name}()`);
    };
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return chain;
      },
      maybeSingle: () => Promise.resolve(response),
      insert: mutate("insert"),
      update: mutate("update"),
      delete: mutate("delete"),
      upsert: mutate("upsert"),
    };
    return chain;
  });
  return { from, eqCalls, mutationCalls, callCount: () => call };
}

describe("resolveTenantByHost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1) domínio active + tenant active → ready com o slug correto", async () => {
    const supabase = fakeSupabase([
      { data: { tenant_id: TENANT_A }, error: null },
      { data: { slug: "loja-a", status: "active" }, error: null },
    ]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

    const result = await resolveTenantByHost("loja-a.com.br");
    expect(result).toEqual({ status: "ready", slug: "loja-a" });
  });

  it("2) domínio pending (nunca aparece na query, pois ela já filtra status=active) → not_found", async () => {
    // A query de tenant_domains já inclui `.eq("status", "active")` — um
    // domínio pending nunca bate nela, então a resposta simulada aqui é
    // exatamente o que o Postgres/RLS retornaria: nenhuma linha.
    const supabase = fakeSupabase([{ data: null, error: null }]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

    const result = await resolveTenantByHost("pendente.com.br");
    expect(result).toEqual({ status: "not_found" });
    expect(supabase.callCount()).toBe(1); // nunca chega a consultar tenants.
  });

  it("3) domínio verifying → not_found (mesma razão do pending acima)", async () => {
    const supabase = fakeSupabase([{ data: null, error: null }]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

    const result = await resolveTenantByHost("verificando.com.br");
    expect(result).toEqual({ status: "not_found" });
  });

  it("4) domínio active + tenant suspended → not_found (checagem explícita, não herdada da policy)", async () => {
    const supabase = fakeSupabase([
      { data: { tenant_id: TENANT_A }, error: null },
      { data: { slug: "loja-a", status: "suspended" }, error: null },
    ]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

    const result = await resolveTenantByHost("loja-a.com.br");
    expect(result).toEqual({ status: "not_found" });
  });

  it("5) domínio active + tenant pending → not_found (a policy pública aceitaria a linha; a função rejeita mesmo assim)", async () => {
    const supabase = fakeSupabase([
      { data: { tenant_id: TENANT_A }, error: null },
      { data: { slug: "loja-a", status: "pending" }, error: null },
    ]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

    const result = await resolveTenantByHost("loja-a.com.br");
    expect(result).toEqual({ status: "not_found" });
  });

  it("6) domínio active + tenant deleted → not_found", async () => {
    const supabase = fakeSupabase([
      { data: { tenant_id: TENANT_A }, error: null },
      { data: { slug: "loja-a", status: "deleted" }, error: null },
    ]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

    const result = await resolveTenantByHost("loja-a.com.br");
    expect(result).toEqual({ status: "not_found" });
  });

  it("7) domínio inexistente → not_found", async () => {
    const supabase = fakeSupabase([{ data: null, error: null }]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

    const result = await resolveTenantByHost("nao-existe.com.br");
    expect(result).toEqual({ status: "not_found" });
  });

  it("8) tenant inexistente (linha de tenant_domains órfã) → not_found", async () => {
    const supabase = fakeSupabase([{ data: { tenant_id: TENANT_A }, error: null }, { data: null, error: null }]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

    const result = await resolveTenantByHost("loja-a.com.br");
    expect(result).toEqual({ status: "not_found" });
  });

  it("9) host do tenant A nunca retorna o slug do tenant B", async () => {
    const supabase = fakeSupabase([
      { data: { tenant_id: TENANT_A }, error: null },
      { data: { slug: "loja-a", status: "active" }, error: null },
    ]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

    const result = await resolveTenantByHost("loja-a.com.br");
    expect(result).toEqual({ status: "ready", slug: "loja-a" });
    expect(result).not.toEqual({ status: "ready", slug: "loja-b" });

    const supabaseB = fakeSupabase([
      { data: { tenant_id: TENANT_B }, error: null },
      { data: { slug: "loja-b", status: "active" }, error: null },
    ]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabaseB as never);
    const resultB = await resolveTenantByHost("loja-b.com.br");
    expect(resultB).toEqual({ status: "ready", slug: "loja-b" });
  });

  it("10) a query usa exatamente o host recebido (nunca um valor derivado/transformado)", async () => {
    const supabase = fakeSupabase([{ data: null, error: null }]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

    await resolveTenantByHost("minhaloja.com.br");
    expect(supabase.eqCalls[0]!.filters).toContainEqual(["domain", "minhaloja.com.br"]);
  });

  it("11) status=active é exigido explicitamente em tenant_domains", async () => {
    const supabase = fakeSupabase([{ data: null, error: null }]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

    await resolveTenantByHost("loja-a.com.br");
    expect(supabase.eqCalls[0]!.table).toBe("tenant_domains");
    expect(supabase.eqCalls[0]!.filters).toContainEqual(["status", "active"]);
  });

  it("12) status=active é exigido explicitamente em tenants (código da função, não só a policy)", async () => {
    const supabase = fakeSupabase([
      { data: { tenant_id: TENANT_A }, error: null },
      { data: { slug: "loja-a", status: "active" }, error: null },
    ]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

    await resolveTenantByHost("loja-a.com.br");
    expect(supabase.eqCalls[1]!.table).toBe("tenants");
    // A query em si só filtra por `id` (o tenant_id resolvido) — quem
    // decide `status === 'active'` é o código da função, checado acima
    // pelos testes 4/5/6 (suspended/pending/deleted todos bloqueados).
    expect(supabase.eqCalls[1]!.filters).toContainEqual(["id", TENANT_A]);
  });

  it("13) o tenant_id usado na segunda consulta vem exclusivamente da primeira (nunca de um parâmetro externo) — mesmo host sempre produz o mesmo tenant_id nas duas chamadas", async () => {
    const supabase = fakeSupabase([
      { data: { tenant_id: TENANT_A }, error: null },
      { data: { slug: "loja-a", status: "active" }, error: null },
    ]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

    await resolveTenantByHost("loja-a.com.br");
    const tenantIdUsedInSecondQuery = supabase.eqCalls[1]!.filters.find(([col]) => col === "id")?.[1];
    expect(tenantIdUsedInSecondQuery).toBe(TENANT_A);
  });

  it("14) nunca usa service_role — só createSupabasePublicClient", async () => {
    const supabase = fakeSupabase([{ data: null, error: null }]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

    await resolveTenantByHost("loja-a.com.br");
    expect(createSupabasePublicClient).toHaveBeenCalledTimes(1);
  });

  it("15) resultado ready nunca contém tenant_id nem qualquer dado administrativo — só { status, slug }", async () => {
    const supabase = fakeSupabase([
      { data: { tenant_id: TENANT_A }, error: null },
      { data: { slug: "loja-a", status: "active" }, error: null },
    ]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

    const result = await resolveTenantByHost("loja-a.com.br");
    expect(Object.keys(result).sort()).toEqual(["slug", "status"]);
    expect(JSON.stringify(result)).not.toContain(TENANT_A);
  });

  it("16) função não cria efeitos colaterais — nunca chama insert/update/delete/upsert, só leitura", async () => {
    const supabase = fakeSupabase([
      { data: { tenant_id: TENANT_A }, error: null },
      { data: { slug: "loja-a", status: "active" }, error: null },
    ]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

    await resolveTenantByHost("loja-a.com.br");
    expect(supabase.mutationCalls).toEqual([]);
  });

  it("não lança para erro inesperado de banco — trata como not_found (mesmo padrão de resolveStorefrontTenant)", async () => {
    const supabase = fakeSupabase([{ data: null, error: { message: "connection reset" } }]);
    vi.mocked(createSupabasePublicClient).mockReturnValue(supabase as never);

    await expect(resolveTenantByHost("loja-a.com.br")).resolves.toEqual({ status: "not_found" });
  });
});
