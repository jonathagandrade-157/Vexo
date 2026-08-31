/**
 * D11.3 — `/master/administradores` é somente leitura de `platform_admins`
 * (Etapa 2): nenhuma mutação (adicionar/alterar papel/remover) é exposta
 * pela aplicação, por decisão de segurança já existente antes deste
 * trabalho — INSERT/UPDATE/DELETE em `platform_admins` já são revogados
 * de `anon`/`authenticated`/`service_role`, exaustivamente testado em
 * `tests/integration/rls-isolation.test.ts` (testes 10/11: "neither
 * authenticated nor service_role can insert/update a platform_admin").
 * Este arquivo cobre só o que é novo no D11.3 — a query real de listagem
 * (`listPlatformAdmins`, via SQL equivalente) sob RLS — sem duplicar
 * aquela cobertura já existente. Mesmo padrão de asActor/expectPgError
 * contra SQL direto de master-tenants.test.ts.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Master — Administradores (D11.3, somente leitura)", () => {
  let fx: Fixtures;
  let userSupportAgent: string;

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`support-agent-admins-${runId}@fixtures.test`],
      );
      userSupportAgent = rows[0]!.id;
      await client.query("insert into public.platform_admins (user_id, role) values ($1, 'SUPPORT_AGENT')", [userSupportAgent]);
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("MASTER consegue listar platform_admins (vê a si mesmo e o SUPPORT_AGENT recém-criado)", async () => {
    const result = await asActor({ role: "authenticated", userId: fx.userMaster }, (c) =>
      c.query("select user_id, role from public.platform_admins order by created_at"),
    );
    const roles = result.rows.map((r) => r.role);
    expect(roles).toContain("MASTER");
    expect(roles).toContain("SUPPORT_AGENT");
    expect(result.rows.some((r) => r.user_id === userSupportAgent)).toBe(true);
  });

  it("SUPPORT_AGENT consegue listar platform_admins (is_platform_admin() cobre os dois papéis, mesma policy do D11.2)", async () => {
    const result = await asActor({ role: "authenticated", userId: userSupportAgent }, (c) =>
      c.query("select user_id, role from public.platform_admins where user_id = $1", [fx.userMaster]),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.role).toBe("MASTER");
  });

  it("um membro comum de tenant (não platform_admin) não vê nenhuma linha — RLS filtra, nunca um erro que revele a existência da tabela", async () => {
    const result = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select id from public.platform_admins limit 1"),
    );
    expect(result.rows).toHaveLength(0);
  });

  it("anon não vê nenhuma linha (mesmo achado de infraestrutura de teste do D11.2: anon tem GRANT de tabela só neste ambiente local, mas RLS não tem nenhuma policy para anon)", async () => {
    const result = await asActor({ role: "anon" }, (c) => c.query("select id from public.platform_admins limit 1"));
    expect(result.rows).toHaveLength(0);
  });

  it("nenhum dado sensível (token/secret/senha) existe em platform_admins — schema só tem id/user_id/role/created_at", async () => {
    const result = await withSuperuser((c) =>
      c.query(
        "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'platform_admins'",
      ),
    );
    const columns = result.rows.map((r) => r.column_name).sort();
    expect(columns).toEqual(["created_at", "id", "role", "user_id"]);
  });
});
