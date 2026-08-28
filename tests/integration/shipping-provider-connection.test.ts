/**
 * D3.2-B — conexão OAuth com o Melhor Envio (SOMENTE conectar a conta;
 * nenhuma cotação/etiqueta/rastreio nesta etapa). RLS/trigger/RPC
 * testados diretamente via SQL (asActor), mesmo padrão de
 * tests/integration/payments.test.ts (Etapa 11). O fluxo OAuth em si
 * (assinatura/expiração do `state`, construção da URL de autorização, a
 * troca do code por tokens) já é coberto por tests/unit/oauth-state.test.ts
 * (reaproveitado, genérico), tests/unit/melhorenvio-gateway.test.ts e
 * tests/unit/melhorenvio-callback-route.test.ts (mockando fetch/Supabase)
 * — aqui o foco é a camada de banco: permissões, RLS, vault (estrutural,
 * sem pgsodium real — ver stub em tests/integration/fixtures/supabase-stub.sql),
 * reconexão/desconexão, isolamento de tenant, e auditoria.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Conexão com o Melhor Envio (D3.2-B)", () => {
  let fx: Fixtures;
  let userAOperator: string;

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`shipping-provider-operator-${runId}@fixtures.test`],
      );
      userAOperator = rows[0]!.id;
      await client.query(
        "insert into public.tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)",
        [fx.tenantA, userAOperator, fx.roleIds.OPERATOR],
      );
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // 6/7 (matriz de permissões) — shipping_provider.manage é OWNER/ADMIN
  // só; shipping_provider.view também inclui MANAGER; OPERATOR não tem
  // nenhuma das duas.
  it("shipping_provider.manage is OWNER/ADMIN only; shipping_provider.view also includes MANAGER; OPERATOR has neither", async () => {
    const canManage = async (userId: string) =>
      asActor({ role: "authenticated", userId }, (c) =>
        c.query<{ has_permission: boolean }>("select has_permission($1, 'shipping_provider.manage')", [fx.tenantA]),
      ).then((r) => r.rows[0]!.has_permission);
    const canView = async (userId: string) =>
      asActor({ role: "authenticated", userId }, (c) =>
        c.query<{ has_permission: boolean }>("select has_permission($1, 'shipping_provider.view')", [fx.tenantA]),
      ).then((r) => r.rows[0]!.has_permission);

    expect(await canManage(fx.userAOwner)).toBe(true);
    expect(await canManage(fx.userAAdmin)).toBe(true);
    expect(await canManage(fx.userAManager)).toBe(false);
    expect(await canView(fx.userAManager)).toBe(true);
    expect(await canManage(userAOperator)).toBe(false);
    expect(await canView(userAOperator)).toBe(false);
  });

  // 12 — conexão criada corretamente; conexão duplicada é bloqueada
  // (unique(tenant_id, provider)).
  it("a tenant cannot have two connection rows for the same provider", async () => {
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("insert into public.store_shipping_providers (tenant_id, provider, status) values ($1, 'melhor_envio', 'connected')", [fx.tenantA]),
      { commit: true },
    );
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("insert into public.store_shipping_providers (tenant_id, provider, status) values ($1, 'melhor_envio', 'connected')", [fx.tenantA]),
      ),
    );
    expect(err.message).toMatch(/duplicate key|unique constraint/i);

    await withSuperuser((c) => c.query("delete from public.store_shipping_providers where tenant_id = $1", [fx.tenantA]));
  });

  // 7 — RLS: só shipping_provider.manage insere/atualiza; nunca delete
  // para ninguém (nem para quem tem .manage — mesmo desenho de
  // store_payment_providers, "nunca delete direto").
  it("RLS: only shipping_provider.manage can write store_shipping_providers, and nobody (not even .manage) can delete it directly", async () => {
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: userAOperator }, (c) =>
        c.query("insert into public.store_shipping_providers (tenant_id, provider, status) values ($1, 'melhor_envio', 'connected')", [fx.tenantA]),
      ),
    );
    expect(err.message).toMatch(/row-level security|permission denied/i);

    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("insert into public.store_shipping_providers (tenant_id, provider, status) values ($1, 'melhor_envio', 'connected')", [fx.tenantA]),
      { commit: true },
    );

    const deleteErr = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("delete from public.store_shipping_providers where tenant_id = $1", [fx.tenantA]),
      ),
    );
    expect(deleteErr.message).toMatch(/permission denied/i);

    await withSuperuser((c) => c.query("delete from public.store_shipping_providers where tenant_id = $1", [fx.tenantA]));
  });

  // 7 — tenant B não vê/lê a conexão do tenant A.
  it("a different tenant cannot see another tenant's shipping provider connection", async () => {
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("insert into public.store_shipping_providers (tenant_id, provider, status) values ($1, 'melhor_envio', 'connected')", [fx.tenantA]),
      { commit: true },
    );

    const asTenantB = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("select 1 from public.store_shipping_providers where tenant_id = $1", [fx.tenantA]),
    );
    expect(asTenantB.rows).toHaveLength(0);

    const asOperatorNoView = await asActor({ role: "authenticated", userId: userAOperator }, (c) =>
      c.query("select 1 from public.store_shipping_providers where tenant_id = $1", [fx.tenantA]),
    );
    expect(asOperatorNoView.rows).toHaveLength(0);

    await withSuperuser((c) => c.query("delete from public.store_shipping_providers where tenant_id = $1", [fx.tenantA]));
  });

  // 8 — shipping_credentials_vault: zero RLS access, zero grant para
  // anon/authenticated, e as funções do vault exigem service_role.
  it("shipping_credentials_vault: zero RLS access for anon/authenticated, and the vault functions require service_role", async () => {
    await withSuperuser((c) =>
      c.query(
        `insert into public.shipping_credentials_vault (tenant_id, provider, access_token_secret_id)
         values ($1, 'melhor_envio', vault.create_secret('fake-token-for-setup'))
         on conflict (tenant_id, provider) do nothing`,
        [fx.tenantA],
      ),
    );

    // D3.2-B (correção 090) — `authenticated` não tem mais nenhum grant de
    // tabela sobre shipping_credentials_vault (revogado para alinhar com
    // payment_credentials_vault), então o SELECT agora falha na camada de
    // GRANT ("permission denied"), antes mesmo de chegar à RLS — mais
    // restritivo que o "0 linhas via RLS" de antes da 090.
    const selectErr = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("select 1 from public.shipping_credentials_vault where tenant_id = $1", [fx.tenantA]),
      ),
    );
    expect(selectErr.message).toMatch(/permission denied/i);

    const insertErr = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("insert into public.shipping_credentials_vault (tenant_id, provider, access_token_secret_id) values ($1, 'melhor_envio', gen_random_uuid())", [fx.tenantA]),
      ),
    );
    expect(insertErr.message).toMatch(/row-level security|permission denied/i);

    const anonErr = await expectPgError(
      asActor({ role: "anon" }, (c) => c.query("select private.get_shipping_credentials($1, 'melhor_envio')", [fx.tenantA])),
    );
    expect(anonErr.message).toMatch(/permission denied/i);

    const authErr = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("select private.get_shipping_credentials($1, 'melhor_envio')", [fx.tenantA]),
      ),
    );
    expect(authErr.message).toMatch(/permission denied/i);

    await withSuperuser((c) => c.query("delete from public.shipping_credentials_vault where tenant_id = $1", [fx.tenantA]));
  });

  // 8/13/14 — store/get/delete_shipping_credentials round-trip via
  // service_role; token nunca aparece fora da função dedicada; reconexão
  // não deixa segredo órfão; expires_at/refresh_expires_at persistidos.
  //
  // Rastreia os `*_secret_id` específicos desta linha (nunca um
  // `count(*)` global de `vault.secrets`): essa tabela é compartilhada
  // por TODO o banco de teste, então um `count(*)` antes/depois quebra
  // sob paralelismo real de arquivos do vitest — outro arquivo de
  // integração (ex.: tests/integration/shipping-token-refresh.test.ts)
  // rodando concorrentemente também cria/apaga segredos nesse intervalo.
  // Verificar os IDs exatos desta linha é imune a isso.
  it("store/get/delete_shipping_credentials round-trip via service_role, persisting both expiries, and secrets are removed on reconnect/disconnect", async () => {
    const expiresAt = "2026-09-27T00:00:00Z";
    const refreshExpiresAt = "2026-10-12T00:00:00Z";

    async function secretIdsFor(tenantId: string) {
      const { rows } = await withSuperuser((c) =>
        c.query<{ access_token_secret_id: string; refresh_token_secret_id: string | null }>(
          "select access_token_secret_id, refresh_token_secret_id from public.shipping_credentials_vault where tenant_id = $1 and provider = 'melhor_envio'",
          [tenantId],
        ),
      );
      return rows[0]!;
    }

    async function secretExists(secretId: string): Promise<boolean> {
      const { rows } = await withSuperuser((c) => c.query("select 1 from vault.secrets where id = $1", [secretId]));
      return rows.length > 0;
    }

    await asActor(
      { role: "service_role" },
      (c) =>
        c.query("select private.store_shipping_credentials($1, 'melhor_envio', 'access-token-1', 'refresh-token-1', $2, $3)", [
          fx.tenantA,
          expiresAt,
          refreshExpiresAt,
        ]),
      { commit: true },
    );

    const read = await asActor({ role: "service_role" }, (c) =>
      c.query<{ access_token: string; refresh_token: string; expires_at: Date; refresh_expires_at: Date }>(
        "select access_token, refresh_token, expires_at, refresh_expires_at from private.get_shipping_credentials($1, 'melhor_envio')",
        [fx.tenantA],
      ),
    );
    expect(read.rows[0]!.access_token).toBe("access-token-1");
    expect(read.rows[0]!.refresh_token).toBe("refresh-token-1");
    expect(new Date(read.rows[0]!.expires_at).toISOString()).toBe(new Date(expiresAt).toISOString());
    expect(new Date(read.rows[0]!.refresh_expires_at).toISOString()).toBe(new Date(refreshExpiresAt).toISOString());

    const idsBefore = await secretIdsFor(fx.tenantA);

    // Reconectar (store de novo — ex.: lojista desconectou e reconectou)
    // não deixa os segredos antigos órfãos no vault.
    await asActor(
      { role: "service_role" },
      (c) => c.query("select private.store_shipping_credentials($1, 'melhor_envio', 'access-token-2', 'refresh-token-2', null, null)", [fx.tenantA]),
      { commit: true },
    );
    const idsAfterReconnect = await secretIdsFor(fx.tenantA);
    expect(idsAfterReconnect.access_token_secret_id).not.toBe(idsBefore.access_token_secret_id);
    expect(idsAfterReconnect.refresh_token_secret_id).not.toBe(idsBefore.refresh_token_secret_id);
    expect(await secretExists(idsBefore.access_token_secret_id)).toBe(false);
    expect(await secretExists(idsBefore.refresh_token_secret_id!)).toBe(false);
    expect(await secretExists(idsAfterReconnect.access_token_secret_id)).toBe(true);
    expect(await secretExists(idsAfterReconnect.refresh_token_secret_id!)).toBe(true);

    const readAgain = await asActor({ role: "service_role" }, (c) =>
      c.query<{ access_token: string }>("select access_token from private.get_shipping_credentials($1, 'melhor_envio')", [fx.tenantA]),
    );
    expect(readAgain.rows[0]!.access_token).toBe("access-token-2");

    await asActor({ role: "service_role" }, (c) => c.query("select private.delete_shipping_credentials($1, 'melhor_envio')", [fx.tenantA]), {
      commit: true,
    });
    const afterDelete = await asActor({ role: "service_role" }, (c) =>
      c.query("select access_token from private.get_shipping_credentials($1, 'melhor_envio')", [fx.tenantA]),
    );
    expect(afterDelete.rows).toHaveLength(0);
    expect(await secretExists(idsAfterReconnect.access_token_secret_id)).toBe(false);
    expect(await secretExists(idsAfterReconnect.refresh_token_secret_id!)).toBe(false);
  });

  // 7 — tenant A não consegue ler/apagar as credenciais do tenant B
  // mesmo via service_role (a função sempre exige o tenant_id certo — a
  // separação real vem de quem CHAMA a função nunca aceitar um tenant_id
  // arbitrário do cliente, não de uma restrição dentro da função em si).
  //
  // Autossuficiente de propósito: cada tenant recebe seu próprio valor
  // sentinela armazenado NESTE teste (nunca assume que um tenant já está
  // "vazio" por causa da limpeza de um teste anterior — essa suposição de
  // ordem entre testes foi a causa raiz de uma falha em cascata real
  // quando um teste anterior falhava antes de rodar sua própria limpeza).
  it("get/delete_shipping_credentials scoped to the wrong tenant never touches another tenant's secret", async () => {
    await asActor(
      { role: "service_role" },
      (c) => c.query("select private.store_shipping_credentials($1, 'melhor_envio', 'tenant-a-own-access', 'tenant-a-own-refresh', null, null)", [fx.tenantA]),
      { commit: true },
    );
    await asActor(
      { role: "service_role" },
      (c) => c.query("select private.store_shipping_credentials($1, 'melhor_envio', 'tenant-b-access', 'tenant-b-refresh', null, null)", [fx.tenantB]),
      { commit: true },
    );

    // Ler B nunca vaza o valor de A, e vice-versa — cada leitura só volta
    // o valor exatamente daquele tenant, nunca do outro nem vazio por
    // acidente de ordem de execução.
    const readA = await asActor({ role: "service_role" }, (c) =>
      c.query<{ access_token: string }>("select access_token from private.get_shipping_credentials($1, 'melhor_envio')", [fx.tenantA]),
    );
    expect(readA.rows[0]!.access_token).toBe("tenant-a-own-access");

    await asActor({ role: "service_role" }, (c) => c.query("select private.delete_shipping_credentials($1, 'melhor_envio')", [fx.tenantA]), {
      commit: true,
    });

    // Apagar A não apaga/lê nada de B.
    const stillThere = await asActor({ role: "service_role" }, (c) =>
      c.query<{ access_token: string }>("select access_token from private.get_shipping_credentials($1, 'melhor_envio')", [fx.tenantB]),
    );
    expect(stillThere.rows[0]!.access_token).toBe("tenant-b-access");

    // E A de fato foi removido pela própria chamada (nunca preservado por engano).
    const goneA = await asActor({ role: "service_role" }, (c) =>
      c.query("select access_token from private.get_shipping_credentials($1, 'melhor_envio')", [fx.tenantA]),
    );
    expect(goneA.rows).toHaveLength(0);

    await asActor({ role: "service_role" }, (c) => c.query("select private.delete_shipping_credentials($1, 'melhor_envio')", [fx.tenantB]), {
      commit: true,
    });
  });

  // 13 — reconexão atualiza corretamente os dados do metadado
  // (upsert por tenant_id+provider, nunca duplica linha).
  it("reconnecting (upsert) updates the same metadata row instead of creating a second one", async () => {
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) =>
        c.query(
          `insert into public.store_shipping_providers (tenant_id, provider, status, sandbox, connected_at)
           values ($1, 'melhor_envio', 'connected', true, now())`,
          [fx.tenantA],
        ),
      { commit: true },
    );
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) =>
        c.query(
          `insert into public.store_shipping_providers (tenant_id, provider, status, sandbox, connected_at)
           values ($1, 'melhor_envio', 'connected', false, now())
           on conflict (tenant_id, provider) do update set sandbox = excluded.sandbox, connected_at = excluded.connected_at`,
          [fx.tenantA],
        ),
      { commit: true },
    );

    const rows = await withSuperuser((c) =>
      c.query<{ sandbox: boolean }>("select sandbox from public.store_shipping_providers where tenant_id = $1", [fx.tenantA]),
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.sandbox).toBe(false);

    await withSuperuser((c) => c.query("delete from public.store_shipping_providers where tenant_id = $1", [fx.tenantA]));
  });

  // 14 — desconexão marca disconnected (nunca deleta a linha de
  // metadado — mesmo desenho de store_payment_providers, "nunca delete
  // direto"; o histórico mínimo fica, sem nenhuma credencial acessível).
  it("disconnecting sets status='disconnected'/disconnected_at, keeps the metadata row, but leaves no credential accessible", async () => {
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) =>
        c.query(
          `insert into public.store_shipping_providers (tenant_id, provider, status, connected_at) values ($1, 'melhor_envio', 'connected', now())`,
          [fx.tenantA],
        ),
      { commit: true },
    );
    await asActor(
      { role: "service_role" },
      (c) => c.query("select private.store_shipping_credentials($1, 'melhor_envio', 'to-be-removed', null, null, null)", [fx.tenantA]),
      { commit: true },
    );

    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) =>
        c.query(
          "update public.store_shipping_providers set status = 'disconnected', disconnected_at = now() where tenant_id = $1 and provider = 'melhor_envio'",
          [fx.tenantA],
        ),
      { commit: true },
    );
    await asActor({ role: "service_role" }, (c) => c.query("select private.delete_shipping_credentials($1, 'melhor_envio')", [fx.tenantA]), {
      commit: true,
    });

    const row = await withSuperuser((c) =>
      c.query<{ status: string; disconnected_at: Date | null }>(
        "select status, disconnected_at from public.store_shipping_providers where tenant_id = $1",
        [fx.tenantA],
      ),
    );
    expect(row.rows[0]).toMatchObject({ status: "disconnected" });
    expect(row.rows[0]!.disconnected_at).not.toBeNull();

    const credentials = await asActor({ role: "service_role" }, (c) =>
      c.query("select access_token from private.get_shipping_credentials($1, 'melhor_envio')", [fx.tenantA]),
    );
    expect(credentials.rows).toHaveLength(0);

    await withSuperuser((c) => c.query("delete from public.store_shipping_providers where tenant_id = $1", [fx.tenantA]));
  });

  // 15/audit — auditoria registra conexão/desconexão nunca com token, e o
  // account id fica mascarado (reaproveita private.mask_account_id()).
  it("audit log records SHIPPING_PROVIDER_CONNECTION_CREATED/REMOVED with a masked account id, never a raw token", async () => {
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) =>
        c.query(
          "insert into public.store_shipping_providers (tenant_id, provider, status, connected_account_id) values ($1, 'melhor_envio', 'connected', 'me-1234567890123456')",
          [fx.tenantA],
        ),
      { commit: true },
    );
    await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) =>
        c.query(
          "update public.store_shipping_providers set status = 'disconnected', disconnected_at = now() where tenant_id = $1 and provider = 'melhor_envio'",
          [fx.tenantA],
        ),
      { commit: true },
    );

    // desc + limit 1 por ação (mesmo padrão de tests/integration/payments.test.ts
    // para PAYMENT_CONNECTION_CREATED) — testes anteriores neste arquivo já
    // inserem/atualizam store_shipping_providers para o tenantA sem
    // connected_account_id, então pegar a linha mais RECENTE de cada ação
    // é o que garante testar o evento desta chamada, não um resíduo de
    // uma execução anterior.
    const [{ rows: createdRows }, { rows: removedRows }] = await Promise.all([
      withSuperuser((c) =>
        c.query<{ after: Record<string, unknown> | null }>(
          "select after from public.audit_logs where tenant_id = $1 and resource_type = 'shipping_provider' and action = 'SHIPPING_PROVIDER_CONNECTION_CREATED' order by created_at desc limit 1",
          [fx.tenantA],
        ),
      ),
      withSuperuser((c) =>
        c.query<{ before: Record<string, unknown> | null }>(
          "select before from public.audit_logs where tenant_id = $1 and resource_type = 'shipping_provider' and action = 'SHIPPING_PROVIDER_CONNECTION_REMOVED' order by created_at desc limit 1",
          [fx.tenantA],
        ),
      ),
    ]);
    expect(createdRows).toHaveLength(1);
    expect(removedRows).toHaveLength(1);

    const created = createdRows[0]!;
    expect(created.after!.connected_account_id).toBe("***************3456");

    const logs = await withSuperuser((c) =>
      c.query<{ after: Record<string, unknown> | null; before: Record<string, unknown> | null }>(
        "select after, before from public.audit_logs where tenant_id = $1 and resource_type = 'shipping_provider'",
        [fx.tenantA],
      ),
    );
    for (const row of logs.rows) {
      const serialized = JSON.stringify([row.after, row.before]);
      expect(serialized).not.toContain("me-1234567890123456");
      expect(serialized).not.toMatch(/access-token|refresh-token/);
    }

    await withSuperuser((c) => c.query("delete from public.store_shipping_providers where tenant_id = $1", [fx.tenantA]));
  });

  // Nunca aceita um `provider` fora de 'melhor_envio' — mesmo desenho de
  // store_payment_providers (check explícito, não enum livre).
  it("rejects any provider value other than 'melhor_envio'", async () => {
    const err = await expectPgError(
      asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
        c.query("insert into public.store_shipping_providers (tenant_id, provider, status) values ($1, 'correios', 'connected')", [fx.tenantA]),
      ),
    );
    expect(err.message).toMatch(/check constraint/i);
  });
});
