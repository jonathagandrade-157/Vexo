import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * D17.3.2 — `startDomainVerification`/`checkDomainVerification` usam
 * `service_role` para o isolamento entre tenants (`tenant_domains` não
 * tem RLS de `authenticated` — D17.1/D17.2), então RLS não é o mecanismo
 * que impede um tenant de ler/escrever o domínio de outro aqui: a única
 * barreira é o filtro `.eq("id", domainId).eq("tenant_id", tenantId)` no
 * próprio código da Action. Testar isso exige mockar o client Supabase e
 * verificar o comportamento real do código — mesmo padrão já
 * estabelecido em `tests/unit/master-tenants-data.test.ts` (client
 * mockado via `vi.mock`, nunca uma segunda implementação de leitura,
 * nenhum dado real de produção). Nenhuma Server Action deste projeto tem
 * um "*-actions.test.ts" com Postgres real por trás (ver relatório
 * D17.3.2, seção L) — o isolamento de RLS em si (que não mudou nesta
 * etapa: nenhuma migration nova) continua coberto pelos testes de
 * integração já existentes de D17.1/D17.2/D17.3.1.
 */
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceRoleClient: vi.fn(),
}));
vi.mock("@/features/onboarding/resolve-tenant", () => ({
  resolveActiveTenantForUser: vi.fn(),
}));
vi.mock("@/lib/security/dns-verification", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/dns-verification")>();
  return { ...actual, checkDomainChallengeTxt: vi.fn() };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { checkDomainVerification, startDomainVerification } from "@/features/settings/domain-verification-actions";
import { hashDomainChallenge } from "@/lib/security/domain-challenge";
import { checkDomainChallengeTxt } from "@/lib/security/dns-verification";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const DOMAIN_ID = "22222222-2222-2222-2222-222222222222";

/** Cada chamada a `.from("tenant_domains")` consome a próxima resposta enfileirada — reflete a ordem exata de chamadas que o código real faz (find, depois update). */
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

describe("startDomainVerification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1/3) domainId de outro tenant (ou inexistente) retorna erro genérico e não altera nada", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([{ data: null, error: null }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await startDomainVerification(DOMAIN_ID);

    expect(result).toEqual({ success: false, error: "Domínio não encontrado." });
    expect(client.callCount()).toBe(1); // só o find — nenhum update foi tentado.
  });

  it("4) usuário sem settings.update não consegue iniciar — nem chega a consultar o domínio", async () => {
    mockSession(false);
    const client = makeServiceRoleClient([]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await startDomainVerification(DOMAIN_ID);

    expect(result).toEqual({ success: false, error: "Você não tem permissão para gerenciar domínios desta loja." });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("domain_type diferente de custom é rejeitado", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([
      { data: { id: DOMAIN_ID, domain: "loja.vexo.app", domain_type: "subdomain", status: "active" }, error: null },
    ]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await startDomainVerification(DOMAIN_ID);

    expect(result).toEqual({ success: false, error: "Este domínio não pode ser verificado." });
    expect(client.callCount()).toBe(1);
  });

  it("6/7) domínio custom inicia verificação: grava method=dns_txt, hash/started_at/expires_at preenchidos, status=verifying — numa única operação", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([
      { data: { id: DOMAIN_ID, domain: "minhaloja.com.br", domain_type: "custom", status: "pending" }, error: null },
      { data: null, error: null },
    ]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await startDomainVerification(DOMAIN_ID);

    expect(result.success).toBe(true);
    expect(result.domain).toBe("minhaloja.com.br");
    expect(result.verificationMethod).toBe("dns_txt");
    expect(result.dnsRecordName).toBe("_vexo-challenge.minhaloja.com.br");
    expect(client.callCount()).toBe(2);

    const payload = client.updatePayloads[0]!;
    expect(payload).toMatchObject({ verification_method: "dns_txt", status: "verifying", last_verification_at: null });
    expect(payload.verification_token_hash).toEqual(expect.any(String));
    expect(payload.verification_started_at).toEqual(expect.any(String));
    expect(payload.verification_expires_at).toEqual(expect.any(String));
  });

  it("8/24) o token puro nunca é o valor gravado — só o hash SHA-256 dele", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([
      { data: { id: DOMAIN_ID, domain: "minhaloja.com.br", domain_type: "custom", status: "pending" }, error: null },
      { data: null, error: null },
    ]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await startDomainVerification(DOMAIN_ID);
    const persistedHash = client.updatePayloads[0]!.verification_token_hash as string;

    expect(result.verificationToken).toBeDefined();
    expect(persistedHash).not.toBe(result.verificationToken);
    expect(hashDomainChallenge(result.verificationToken!)).toBe(persistedHash);
  });

  it("um domínio já active também pode ser revalidado explicitamente (rotação intencional, ticket Etapa 5)", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([
      { data: { id: DOMAIN_ID, domain: "minhaloja.com.br", domain_type: "custom", status: "active" }, error: null },
      { data: null, error: null },
    ]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await startDomainVerification(DOMAIN_ID);

    expect(result.success).toBe(true);
    expect(client.updatePayloads[0]).toMatchObject({ status: "verifying" });
  });

  it("12) duas chamadas sucessivas (rotação) produzem tokens/hashes diferentes — o challenge antigo nunca permanece válido", async () => {
    mockSession(true);
    const row = { id: DOMAIN_ID, domain: "minhaloja.com.br", domain_type: "custom", status: "pending" };

    const client1 = makeServiceRoleClient([{ data: row, error: null }, { data: null, error: null }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client1 as never);
    const first = await startDomainVerification(DOMAIN_ID);

    const client2 = makeServiceRoleClient([{ data: row, error: null }, { data: null, error: null }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client2 as never);
    const second = await startDomainVerification(DOMAIN_ID);

    expect(second.verificationToken).not.toBe(first.verificationToken);
    expect(client2.updatePayloads[0]!.verification_token_hash).not.toBe(client1.updatePayloads[0]!.verification_token_hash);
  });
});

describe("checkDomainVerification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("2/3) domainId de outro tenant (ou inexistente) retorna erro genérico e não altera nada", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([{ data: null, error: null }]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await checkDomainVerification(DOMAIN_ID);

    expect(result).toEqual({ success: false, error: "Domínio não encontrado." });
    expect(client.callCount()).toBe(1);
    expect(checkDomainChallengeTxt).not.toHaveBeenCalled();
  });

  it("5) usuário sem settings.update não consegue verificar", async () => {
    mockSession(false);
    const client = makeServiceRoleClient([]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await checkDomainVerification(DOMAIN_ID);

    expect(result).toEqual({ success: false, error: "Você não tem permissão para gerenciar domínios desta loja." });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("9) DNS correto ativa: status=active, verified_at e last_verification_at preenchidos", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([
      {
        data: {
          id: DOMAIN_ID,
          domain: "minhaloja.com.br",
          domain_type: "custom",
          status: "verifying",
          verification_token_hash: "abc123",
          verification_started_at: "2026-01-01T00:00:00.000Z",
          verification_expires_at: "2999-01-01T00:00:00.000Z",
        },
        error: null,
      },
      { data: null, error: null },
    ]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);
    vi.mocked(checkDomainChallengeTxt).mockResolvedValue({ outcome: "match" });

    const result = await checkDomainVerification(DOMAIN_ID);

    expect(result).toEqual({ success: true, status: "active", verified: true, expired: false });
    expect(client.updatePayloads[0]).toMatchObject({ status: "active" });
    expect(client.updatePayloads[0]!.verified_at).toEqual(expect.any(String));
  });

  it("10) DNS incorreto não ativa: permanece verifying, verified_at nunca é setado", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([
      {
        data: {
          id: DOMAIN_ID,
          domain: "minhaloja.com.br",
          domain_type: "custom",
          status: "verifying",
          verification_token_hash: "abc123",
          verification_started_at: "2026-01-01T00:00:00.000Z",
          verification_expires_at: "2999-01-01T00:00:00.000Z",
        },
        error: null,
      },
      { data: null, error: null },
    ]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);
    vi.mocked(checkDomainChallengeTxt).mockResolvedValue({ outcome: "no_match" });

    const result = await checkDomainVerification(DOMAIN_ID);

    expect(result).toEqual({ success: true, status: "verifying", verified: false, expired: false });
    expect(client.updatePayloads[0]).not.toHaveProperty("status");
    expect(client.updatePayloads[0]).not.toHaveProperty("verified_at");
  });

  it("DNS não encontrado (not_found) também mantém verifying, sem ativar", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([
      {
        data: {
          id: DOMAIN_ID,
          domain: "minhaloja.com.br",
          domain_type: "custom",
          status: "verifying",
          verification_token_hash: "abc123",
          verification_started_at: "2026-01-01T00:00:00.000Z",
          verification_expires_at: "2999-01-01T00:00:00.000Z",
        },
        error: null,
      },
      { data: null, error: null },
    ]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);
    vi.mocked(checkDomainChallengeTxt).mockResolvedValue({ outcome: "not_found" });

    const result = await checkDomainVerification(DOMAIN_ID);
    expect(result).toEqual({ success: true, status: "verifying", verified: false, expired: false });
  });

  it("erro transitório de DNS também mantém verifying, sem derrubar a Action", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([
      {
        data: {
          id: DOMAIN_ID,
          domain: "minhaloja.com.br",
          domain_type: "custom",
          status: "verifying",
          verification_token_hash: "abc123",
          verification_started_at: "2026-01-01T00:00:00.000Z",
          verification_expires_at: "2999-01-01T00:00:00.000Z",
        },
        error: null,
      },
      { data: null, error: null },
    ]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);
    vi.mocked(checkDomainChallengeTxt).mockResolvedValue({ outcome: "error", reason: "dns_error" });

    const result = await checkDomainVerification(DOMAIN_ID);
    expect(result).toEqual({ success: true, status: "verifying", verified: false, expired: false });
  });

  it("11) challenge expirado volta para pending, sem consultar DNS e sem gerar novo challenge sozinho", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([
      {
        data: {
          id: DOMAIN_ID,
          domain: "minhaloja.com.br",
          domain_type: "custom",
          status: "verifying",
          verification_token_hash: "abc123",
          verification_started_at: "2020-01-01T00:00:00.000Z",
          verification_expires_at: "2020-01-04T00:00:00.000Z", // já expirado
        },
        error: null,
      },
      { data: null, error: null },
    ]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await checkDomainVerification(DOMAIN_ID);

    expect(result).toEqual({ success: true, status: "pending", verified: false, expired: true });
    expect(checkDomainChallengeTxt).not.toHaveBeenCalled();
    expect(client.updatePayloads[0]).toMatchObject({ status: "pending" });
    // Nenhum challenge novo foi gerado automaticamente (nenhum verification_method/hash/started_at/expires_at no payload).
    expect(client.updatePayloads[0]).not.toHaveProperty("verification_token_hash");
  });

  it("11) idempotência: domínio já active não sofre downgrade nem gera novo challenge num check normal", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([
      { data: { id: DOMAIN_ID, domain: "minhaloja.com.br", domain_type: "custom", status: "active" }, error: null },
    ]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await checkDomainVerification(DOMAIN_ID);

    expect(result).toEqual({ success: true, status: "active", verified: true, expired: false });
    expect(client.callCount()).toBe(1); // nenhum UPDATE — idempotente.
    expect(checkDomainChallengeTxt).not.toHaveBeenCalled();
  });

  it("12) token/hash nunca aparecem no retorno de checkDomainVerification", async () => {
    mockSession(true);
    const client = makeServiceRoleClient([
      {
        data: {
          id: DOMAIN_ID,
          domain: "minhaloja.com.br",
          domain_type: "custom",
          status: "verifying",
          verification_token_hash: "abc123",
          verification_started_at: "2026-01-01T00:00:00.000Z",
          verification_expires_at: "2999-01-01T00:00:00.000Z",
        },
        error: null,
      },
      { data: null, error: null },
    ]);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(client as never);
    vi.mocked(checkDomainChallengeTxt).mockResolvedValue({ outcome: "match" });

    const result = await checkDomainVerification(DOMAIN_ID);

    expect(result).not.toHaveProperty("verificationToken");
    expect(result).not.toHaveProperty("verificationTokenHash");
    expect(JSON.stringify(result)).not.toContain("abc123");
  });
});
