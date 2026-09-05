import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * D17.5.1 — testa `registerDomainOnVercel`/`checkVercelDomainStatus`
 * mockando `@/lib/supabase/server`, `@/features/onboarding/resolve-tenant`
 * e `@/lib/vercel/domains` — mesmo padrão já estabelecido em
 * `tests/unit/domain-verification-actions.test.ts` (D17.3.2). O mapeamento
 * HTTP→código interno já é testado isoladamente em
 * `tests/unit/vercel-domains-client.test.ts` — aqui só interessa COMO a
 * Server Action usa esse resultado (autorização, filtro de tenant,
 * persistência de estado, mensagens nunca vazando detalhe interno).
 */
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceRoleClient: vi.fn(),
}));
vi.mock("@/features/onboarding/resolve-tenant", () => ({
  resolveActiveTenantForUser: vi.fn(),
}));
vi.mock("@/lib/vercel/domains", () => ({
  addVercelDomain: vi.fn(),
  getVercelDomain: vi.fn(),
  getVercelDomainConfig: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { checkVercelDomainStatus, registerDomainOnVercel } from "@/features/settings/domain-vercel-actions";
import { addVercelDomain, getVercelDomain, getVercelDomainConfig } from "@/lib/vercel/domains";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "99999999-9999-9999-9999-999999999999";
const DOMAIN_ID = "22222222-2222-2222-2222-222222222222";

/** Mesmo padrão de `makeServiceRoleClient` em domain-verification-actions.test.ts — cada `.from()` consome a próxima resposta enfileirada. */
function makeServiceRoleClient(responses: { data?: unknown; error?: unknown }[]) {
  let call = 0;
  const updatePayloads: Record<string, unknown>[] = [];
  const from = vi.fn(() => {
    const response = responses[call] ?? { data: null, error: null };
    call += 1;
    const chain = {
      select: () => chain,
      update: (payload: Record<string, unknown>) => {
        updatePayloads.push(payload);
        return chain;
      },
      eq: () => chain,
      maybeSingle: () => Promise.resolve(response),
      then: (resolve: (v: typeof response) => void, reject?: (e: unknown) => void) => Promise.resolve(response).then(resolve, reject),
    };
    return chain;
  });
  return { from, updatePayloads, callCount: () => call };
}

function mockSession(allowed: boolean, tenantId: string = TENANT_A) {
  vi.mocked(resolveActiveTenantForUser).mockResolvedValue({
    tenant: { id: tenantId, onboarding_completed_at: "2026-01-01T00:00:00.000Z" } as never,
    roleKey: "OWNER",
  });
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    rpc: vi.fn().mockResolvedValue({ data: allowed, error: null }),
  } as never);
}

function activeCustomDomainRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DOMAIN_ID,
    domain: "loja.com.br",
    domain_type: "custom",
    status: "active",
    vercel_registered_at: null,
    ...overrides,
  };
}

describe("registerDomainOnVercel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1) domínio VEXO não verificado (pending) → bloqueado, nunca chama a Vercel", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([{ data: activeCustomDomainRow({ status: "pending" }), error: null }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await registerDomainOnVercel(DOMAIN_ID);

    expect(result.success).toBe(false);
    expect(addVercelDomain).not.toHaveBeenCalled();
  });

  it("1b) domínio VEXO verifying → bloqueado, nunca chama a Vercel", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([{ data: activeCustomDomainRow({ status: "verifying" }), error: null }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await registerDomainOnVercel(DOMAIN_ID);

    expect(result.success).toBe(false);
    expect(addVercelDomain).not.toHaveBeenCalled();
  });

  it("2/3) domínio VEXO active → registra na Vercel e persiste registered (verified=true, misconfigured=false)", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([{ data: activeCustomDomainRow(), error: null }, { data: null, error: null }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);
    vi.mocked(addVercelDomain).mockResolvedValue({
      ok: true,
      alreadyRegistered: false,
      domain: { name: "loja.com.br", apexName: "loja.com.br", projectId: "prj_test", verified: true },
    });
    vi.mocked(getVercelDomainConfig).mockResolvedValue({ ok: true, config: { misconfigured: false } });

    const result = await registerDomainOnVercel(DOMAIN_ID);

    expect(result).toEqual({ success: true, vercelDomainStatus: "registered" });
    expect(addVercelDomain).toHaveBeenCalledWith("loja.com.br");
    const payload = client.updatePayloads[0]!;
    expect(payload).toMatchObject({ vercel_domain_status: "registered", vercel_error_code: null });
    expect(payload.vercel_registered_at).toEqual(expect.any(String));
  });

  it("verified=false (aceito, DNS ainda não aponta pra Vercel) → registering, nunca chama getVercelDomainConfig", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([{ data: activeCustomDomainRow(), error: null }, { data: null, error: null }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);
    vi.mocked(addVercelDomain).mockResolvedValue({
      ok: true,
      alreadyRegistered: false,
      domain: { name: "loja.com.br", apexName: "loja.com.br", projectId: "prj_test", verified: false },
    });

    const result = await registerDomainOnVercel(DOMAIN_ID);

    expect(result).toEqual({ success: true, vercelDomainStatus: "registering" });
    expect(getVercelDomainConfig).not.toHaveBeenCalled();
  });

  it("4) domínio já registrado no mesmo projeto (alreadyRegistered=true) → sucesso lógico", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([{ data: activeCustomDomainRow(), error: null }, { data: null, error: null }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);
    vi.mocked(addVercelDomain).mockResolvedValue({
      ok: true,
      alreadyRegistered: true,
      domain: { name: "loja.com.br", apexName: "loja.com.br", projectId: "prj_test", verified: true },
    });
    vi.mocked(getVercelDomainConfig).mockResolvedValue({ ok: true, config: { misconfigured: false } });

    const result = await registerDomainOnVercel(DOMAIN_ID);
    expect(result).toEqual({ success: true, vercelDomainStatus: "registered" });
  });

  it("não reescreve vercel_registered_at numa reconfirmação (já estava preenchido)", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([
      { data: activeCustomDomainRow({ vercel_registered_at: "2026-01-01T00:00:00.000Z" }), error: null },
      { data: null, error: null },
    ]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);
    vi.mocked(addVercelDomain).mockResolvedValue({
      ok: true,
      alreadyRegistered: true,
      domain: { name: "loja.com.br", apexName: "loja.com.br", projectId: "prj_test", verified: true },
    });
    vi.mocked(getVercelDomainConfig).mockResolvedValue({ ok: true, config: { misconfigured: false } });

    await registerDomainOnVercel(DOMAIN_ID);
    expect(client.updatePayloads[0]).not.toHaveProperty("vercel_registered_at");
  });

  it("5) domínio registrado em outro projeto → erro seguro, status configuration_error, nunca revela detalhe técnico", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([{ data: activeCustomDomainRow(), error: null }, { data: null, error: null }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);
    vi.mocked(addVercelDomain).mockResolvedValue({ ok: false, code: "registered_other_project" });

    const result = await registerDomainOnVercel(DOMAIN_ID);

    expect(result.success).toBe(false);
    expect(result.vercelDomainStatus).toBe("configuration_error");
    expect(result.error).not.toMatch(/registered_other_project|vercel|api\.vercel\.com/i);
  });

  it.each(["unauthorized", "forbidden", "not_found", "conflict", "gone", "rate_limited", "timeout", "network_error", "api_error", "invalid_response"] as const)(
    "%s → success:false, vercelDomainStatus persistido, nunca lança",
    async (code) => {
      mockSession(true);
      const client = makeServiceRoleClient([{ data: activeCustomDomainRow(), error: null }, { data: null, error: null }]);
      vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);
      vi.mocked(addVercelDomain).mockResolvedValue({ ok: false, code });

      const result = await registerDomainOnVercel(DOMAIN_ID);
      expect(result.success).toBe(false);
      expect(client.updatePayloads[0]).toMatchObject({ vercel_error_code: code });
    },
  );

  it("22) token/config ausente (addVercelDomain lança) → nunca derruba a Action, retorna erro seguro", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([{ data: activeCustomDomainRow(), error: null }, { data: null, error: null }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);
    vi.mocked(addVercelDomain).mockRejectedValue(new Error("Vercel não configurada: VERCEL_API_TOKEN ausente"));

    await expect(registerDomainOnVercel(DOMAIN_ID)).resolves.toMatchObject({ success: false });
  });

  it("18) domainId de outro tenant (cross-tenant) → não encontrado, nunca chama a Vercel", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([{ data: null, error: null }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await registerDomainOnVercel(DOMAIN_ID);

    expect(result).toEqual({ success: false, error: "Domínio não encontrado." });
    expect(addVercelDomain).not.toHaveBeenCalled();
  });

  it("19) tenant inativo (sem membership ativa) → bloqueado antes de qualquer consulta a domínio", async () => {
    vi.mocked(resolveActiveTenantForUser).mockResolvedValue(null);
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ rpc: vi.fn() } as never);
    const client = makeServiceRoleClient([]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await registerDomainOnVercel(DOMAIN_ID);

    expect(result.success).toBe(false);
    expect(client.from).not.toHaveBeenCalled();
    expect(addVercelDomain).not.toHaveBeenCalled();
  });

  it("20) usuário sem permissão settings.update → bloqueado, nunca consulta domínio nem Vercel", async () => {
    mockSession(false);
    const client = makeServiceRoleClient([]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await registerDomainOnVercel(DOMAIN_ID);

    expect(result).toEqual({ success: false, error: "Você não tem permissão para gerenciar domínios desta loja." });
    expect(client.from).not.toHaveBeenCalled();
    expect(addVercelDomain).not.toHaveBeenCalled();
  });

  it("21) usuário não autenticado (getUser vazio propagado por resolveActiveTenantForUser) → bloqueado", async () => {
    vi.mocked(resolveActiveTenantForUser).mockResolvedValue(null);
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ rpc: vi.fn() } as never);
    const client = makeServiceRoleClient([]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await registerDomainOnVercel(DOMAIN_ID);
    expect(result.success).toBe(false);
  });

  it("23) token nunca aparece no resultado devolvido ao client", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([{ data: activeCustomDomainRow(), error: null }, { data: null, error: null }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);
    vi.mocked(addVercelDomain).mockResolvedValue({
      ok: true,
      alreadyRegistered: false,
      domain: { name: "loja.com.br", apexName: "loja.com.br", projectId: "prj_test", verified: true },
    });
    vi.mocked(getVercelDomainConfig).mockResolvedValue({ ok: true, config: { misconfigured: false } });

    const result = await registerDomainOnVercel(DOMAIN_ID);
    expect(JSON.stringify(result)).not.toMatch(/vca_|token|Authorization/i);
  });

  it("24) usa sempre o domínio da linha do próprio tenant — nunca um domainId sozinho decide o que é enviado à Vercel", async () => {
    mockSession(true, TENANT_B);
    const client = makeServiceRoleClient([{ data: activeCustomDomainRow({ domain: "loja-b.com.br" }), error: null }, { data: null, error: null }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);
    vi.mocked(addVercelDomain).mockResolvedValue({
      ok: true,
      alreadyRegistered: false,
      domain: { name: "loja-b.com.br", apexName: "loja-b.com.br", projectId: "prj_test", verified: true },
    });
    vi.mocked(getVercelDomainConfig).mockResolvedValue({ ok: true, config: { misconfigured: false } });

    await registerDomainOnVercel(DOMAIN_ID);
    expect(addVercelDomain).toHaveBeenCalledWith("loja-b.com.br");
  });

  it("domínio não-custom (subdomínio) é rejeitado, nunca chama a Vercel", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([{ data: activeCustomDomainRow({ domain_type: "subdomain" }), error: null }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await registerDomainOnVercel(DOMAIN_ID);
    expect(result.success).toBe(false);
    expect(addVercelDomain).not.toHaveBeenCalled();
  });
});

describe("checkVercelDomainStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("domínio VEXO não active → bloqueado, nunca consulta a Vercel", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([{ data: activeCustomDomainRow({ status: "pending" }), error: null }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await checkVercelDomainStatus(DOMAIN_ID);
    expect(result.success).toBe(false);
    expect(getVercelDomain).not.toHaveBeenCalled();
  });

  it("7) domínio inexistente na Vercel (not_found) → not_registered, sucesso", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([{ data: activeCustomDomainRow(), error: null }, { data: null, error: null }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);
    vi.mocked(getVercelDomain).mockResolvedValue({ ok: false, code: "not_found" });

    const result = await checkVercelDomainStatus(DOMAIN_ID);
    expect(result).toEqual({ success: true, vercelDomainStatus: "not_registered" });
  });

  it("15) misconfigured=true → configuration_error", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([{ data: activeCustomDomainRow(), error: null }, { data: null, error: null }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);
    vi.mocked(getVercelDomain).mockResolvedValue({
      ok: true,
      domain: { name: "loja.com.br", apexName: "loja.com.br", projectId: "prj_test", verified: true },
    });
    vi.mocked(getVercelDomainConfig).mockResolvedValue({ ok: true, config: { misconfigured: true } });

    const result = await checkVercelDomainStatus(DOMAIN_ID);
    expect(result).toEqual({ success: true, vercelDomainStatus: "configuration_error" });
  });

  it("16) misconfigured=false → registered", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([{ data: activeCustomDomainRow(), error: null }, { data: null, error: null }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);
    vi.mocked(getVercelDomain).mockResolvedValue({
      ok: true,
      domain: { name: "loja.com.br", apexName: "loja.com.br", projectId: "prj_test", verified: true },
    });
    vi.mocked(getVercelDomainConfig).mockResolvedValue({ ok: true, config: { misconfigured: false } });

    const result = await checkVercelDomainStatus(DOMAIN_ID);
    expect(result).toEqual({ success: true, vercelDomainStatus: "registered" });
  });

  it("getVercelDomainConfig falha (erro de rede) → unknown, nunca lança", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([{ data: activeCustomDomainRow(), error: null }, { data: null, error: null }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);
    vi.mocked(getVercelDomain).mockResolvedValue({
      ok: true,
      domain: { name: "loja.com.br", apexName: "loja.com.br", projectId: "prj_test", verified: true },
    });
    vi.mocked(getVercelDomainConfig).mockResolvedValue({ ok: false, code: "network_error" });

    const result = await checkVercelDomainStatus(DOMAIN_ID);
    expect(result).toEqual({ success: true, vercelDomainStatus: "unknown" });
  });

  it("18) cross-tenant domainId → não encontrado, nunca consulta a Vercel", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([{ data: null, error: null }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await checkVercelDomainStatus(DOMAIN_ID);
    expect(result).toEqual({ success: false, error: "Domínio não encontrado." });
    expect(getVercelDomain).not.toHaveBeenCalled();
  });

  it("21) usuário não autenticado → bloqueado", async () => {
    vi.mocked(resolveActiveTenantForUser).mockResolvedValue(null);
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ rpc: vi.fn() } as never);
    const client = makeServiceRoleClient([]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await checkVercelDomainStatus(DOMAIN_ID);
    expect(result.success).toBe(false);
  });

  it("23) token nunca aparece no resultado devolvido ao client", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([{ data: activeCustomDomainRow(), error: null }, { data: null, error: null }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);
    vi.mocked(getVercelDomain).mockResolvedValue({
      ok: true,
      domain: { name: "loja.com.br", apexName: "loja.com.br", projectId: "prj_test", verified: true },
    });
    vi.mocked(getVercelDomainConfig).mockResolvedValue({ ok: true, config: { misconfigured: false } });

    const result = await checkVercelDomainStatus(DOMAIN_ID);
    expect(JSON.stringify(result)).not.toMatch(/vca_|token|Authorization/i);
  });
});
