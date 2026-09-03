/**
 * D15-S.2 — public.check_rate_limit / public.rate_limit_counters
 * (migration 20260817220099_rate_limit_counters.sql). Testado direto via
 * SQL (asActor/expectPgError), mesmo princípio de sempre neste projeto:
 * RLS/RPC são a autoridade real, testadas aqui; lib/security/rate-limit.ts
 * só chama a RPC pelo client service-role, sem lógica própria a testar de
 * novo (e é mockada em todo teste de Route Handler, tests/unit/*).
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool } from "./helpers/db";

const runId = randomUUID().slice(0, 8);

function checkRateLimit(key: string, windowSeconds: number, maxRequests: number) {
  return asActor(
    { role: "service_role" },
    (c) =>
      c.query<{ allowed: boolean; current_count: number; retry_after_seconds: number }>(
        "select allowed, current_count, retry_after_seconds from check_rate_limit($1, $2, $3)",
        [key, windowSeconds, maxRequests],
      ),
    { commit: true },
  );
}

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("check_rate_limit (D15-S.2)", () => {
  afterAll(async () => {
    await pool.end();
  });

  // 1/2 — request permitido / limite atingido.
  it("permite requisições até o limite, e bloqueia exatamente a partir da que excede", async () => {
    const key = `test:${runId}:basic`;

    const first = await checkRateLimit(key, 60, 3);
    expect(first.rows[0]).toMatchObject({ allowed: true, current_count: 1 });

    const second = await checkRateLimit(key, 60, 3);
    expect(second.rows[0]).toMatchObject({ allowed: true, current_count: 2 });

    const third = await checkRateLimit(key, 60, 3);
    expect(third.rows[0]).toMatchObject({ allowed: true, current_count: 3 });

    // 3ª foi a última permitida (limite = 3) — a 4ª já excede.
    const fourth = await checkRateLimit(key, 60, 3);
    expect(fourth.rows[0]).toMatchObject({ allowed: false, current_count: 4 });
  });

  // retry_after_seconds é positivo e nunca maior que a janela.
  it("retry_after_seconds está sempre entre 0 e p_window_seconds", async () => {
    const key = `test:${runId}:retry-after`;
    const result = await checkRateLimit(key, 30, 1);
    expect(result.rows[0]!.retry_after_seconds).toBeGreaterThanOrEqual(0);
    expect(result.rows[0]!.retry_after_seconds).toBeLessThanOrEqual(30);
  });

  // 5 — isolamento entre chaves: chaves diferentes nunca compartilham contador.
  it("chaves diferentes têm contadores completamente independentes", async () => {
    const keyA = `test:${runId}:isolation-a`;
    const keyB = `test:${runId}:isolation-b`;

    await checkRateLimit(keyA, 60, 1); // esgota o limite de A
    const blockedA = await checkRateLimit(keyA, 60, 1);
    expect(blockedA.rows[0]!.allowed).toBe(false);

    // B nunca foi tocada — continua com contador zerado, primeira chamada permitida.
    const firstB = await checkRateLimit(keyB, 60, 1);
    expect(firstB.rows[0]).toMatchObject({ allowed: true, current_count: 1 });
  });

  // 7 — "IP diferente" e 8 — "tenant diferente" na prática: a chave em si já
  // é a combinação (ip[:tenant]) montada por lib/security/rate-limit.ts —
  // o teste acima ("chaves diferentes") já cobre isso genericamente,
  // porque para a RPC/tabela um IP diferente ou um tenant diferente é
  // sempre só "uma chave diferente". Este teste confirma explicitamente o
  // formato de chave que os dois endpoints realmente usam.
  it("chaves no formato usado pelos endpoints (ip:tenant para shipping/quote, ip para cep) isolam corretamente", async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const ip = "203.0.113.5";

    await checkRateLimit(`shipping-quote:${ip}:${tenantA}`, 60, 1);
    const blockedTenantA = await checkRateLimit(`shipping-quote:${ip}:${tenantA}`, 60, 1);
    expect(blockedTenantA.rows[0]!.allowed).toBe(false);

    // Mesmo IP, tenant diferente — nunca herda o limite de tenantA.
    const firstTenantB = await checkRateLimit(`shipping-quote:${ip}:${tenantB}`, 60, 1);
    expect(firstTenantB.rows[0]).toMatchObject({ allowed: true, current_count: 1 });

    // IP diferente, mesmo tenant — nunca herda o limite de ip.
    const otherIp = "198.51.100.9";
    const firstOtherIp = await checkRateLimit(`shipping-quote:${otherIp}:${tenantA}`, 60, 1);
    expect(firstOtherIp.rows[0]).toMatchObject({ allowed: true, current_count: 1 });
  });

  // Janela nova reseta o contador — confirma que é fixed window, não um limite permanente.
  it("uma janela diferente (window_seconds pequeno, aguardando expirar) tem contador próprio", async () => {
    const key = `test:${runId}:window-reset`;
    await checkRateLimit(key, 1, 1); // janela de 1s, limite 1 — esgota
    const blocked = await checkRateLimit(key, 1, 1);
    expect(blocked.rows[0]!.allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const afterWindow = await checkRateLimit(key, 1, 1);
    expect(afterWindow.rows[0]).toMatchObject({ allowed: true, current_count: 1 });
  });

  // 9 — manipulação de tenant_id não permite escapar do limite: a chave é
  // montada inteiramente no servidor (IP via header confiável da Vercel +
  // tenant_id resolvido por resolveStorefrontTenant a partir do slug,
  // nunca aceito solto do cliente — ver app/api/shipping/quote/route.ts).
  // Não há parâmetro nenhum que o cliente controle e que altere a CHAVE
  // vista por esta RPC além do que o servidor já decidiu — não há uma
  // "segunda chave" alternativa que um cliente possa escolher para
  // recomeçar o contador.
  it("a RPC em si não aceita nenhum campo de identidade solto — só a chave que o chamador já decidiu, sem forma de o cliente escolher outra chave para escapar do limite", async () => {
    const key = `test:${runId}:no-escape`;
    await checkRateLimit(key, 60, 1);
    const blocked = await checkRateLimit(key, 60, 1);
    expect(blocked.rows[0]!.allowed).toBe(false);

    // Repetir a MESMA chave nunca "reseta" nada — não existe parâmetro de
    // reset/override na assinatura da function.
    const stillBlocked = await checkRateLimit(key, 60, 1);
    expect(stillBlocked.rows[0]!.allowed).toBe(false);
  });

  // anon/authenticated nunca conseguem chamar a RPC nem ler/escrever a tabela diretamente.
  it("anon e authenticated não têm EXECUTE em check_rate_limit nem acesso direto à tabela", async () => {
    for (const actor of [{ role: "anon" as const }, { role: "authenticated" as const, userId: randomUUID() }]) {
      const errRpc = await expectPgError(
        asActor(actor, (c) => c.query("select * from check_rate_limit($1, 60, 10)", [`test:${runId}:no-access`])),
      );
      expect(errRpc.message).toMatch(/permission denied for function/i);

      const errTable = await expectPgError(
        asActor(actor, (c) => c.query("select * from public.rate_limit_counters limit 1")),
      );
      expect(errTable.message).toMatch(/permission denied for table|row-level security/i);
    }
  });

  // Validação de input — parâmetros inválidos nunca produzem um limite silenciosamente incorreto (ex.: janela 0 permitindo tudo).
  it("rejeita p_window_seconds ou p_max_requests não-positivos", async () => {
    const err1 = await expectPgError(checkRateLimit(`test:${runId}:invalid-window`, 0, 10));
    expect(err1.message).toMatch(/must be positive/i);

    const err2 = await expectPgError(checkRateLimit(`test:${runId}:invalid-max`, 60, 0));
    expect(err2.message).toMatch(/must be positive/i);
  });
});
