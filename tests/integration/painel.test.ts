/**
 * Etapa 5 — painel administrativo do lojista (arquitetura §5/§6/§9/§13/
 * §14 do prompt desta etapa).
 *
 * Mesmo harness e mesmas fixtures de rls-isolation.test.ts/onboarding.test.ts
 * (buildFixtures) — o painel não introduz tabela nova, só uma função RPC
 * (`public.has_permission`) e uma extensão do trigger de auditoria já
 * existente. Muitos dos 18 cenários pedidos no prompt já têm cobertura
 * equivalente em `onboarding.test.ts` (mesma tabela `tenants`, mesma RLS)
 * — este arquivo foca no que É NOVO nesta etapa: o wrapper
 * `public.has_permission()`, a matriz de 5 papéis, e o evento
 * TENANT_SETTINGS_UPDATED. O relatório final mapeia cada um dos 18 itens
 * pedidos ao teste (deste arquivo ou do de onboarding) que o cobre.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

async function saveSettings(
  userId: string,
  tenantId: string,
  overrides: Partial<{
    storeName: string;
    segment: string;
    description: string;
    instagram: string;
    whatsapp: string;
    email: string;
  }> = {},
  options: { commit?: boolean } = {},
) {
  const v = {
    storeName: "Loja Atualizada",
    segment: "electronics",
    description: "Descrição atualizada.",
    instagram: "novamarca",
    whatsapp: "11988887777",
    email: "novo@loja.com.br",
    ...overrides,
  };
  return asActor(
    { role: "authenticated", userId },
    (c) =>
      c.query(
        `update public.tenants
           set name = $1, segment = $2, description = $3,
               instagram_handle = $4, whatsapp_phone = $5, contact_email = $6
         where id = $7
         returning id, name, onboarding_completed_at`,
        [v.storeName, v.segment, v.description, v.instagram, v.whatsapp, v.email, tenantId],
      ),
    options,
  );
}

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Painel do lojista (Etapa 5)", () => {
  let fx: Fixtures;
  /** tenant A com onboarding já concluído (fora do fixture padrão, que deixa pendente) + membros OPERATOR/SUPPORT extras, para a matriz de 5 papéis. */
  let onboardedTenantId: string;
  let userAOperator: string;
  let userASupport: string;

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      await client.query("update public.tenants set onboarding_completed_at = now() where id = $1", [
        fx.tenantA,
      ]);
      onboardedTenantId = fx.tenantA;

      const { rows: opRows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`operator-${runId}@fixtures.test`],
      );
      userAOperator = opRows[0]!.id;
      await client.query(
        "insert into public.tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)",
        [fx.tenantA, userAOperator, fx.roleIds.OPERATOR],
      );

      const { rows: supRows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`support-${runId}@fixtures.test`],
      );
      userASupport = supRows[0]!.id;
      await client.query(
        "insert into public.tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)",
        [fx.tenantA, userASupport, fx.roleIds.SUPPORT],
      );
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // 1/4/18 — qualquer membro ativo (não só OWNER) acessa o próprio tenant já concluído.
  it("any active member (not just OWNER) can see their tenant once onboarding is complete", async () => {
    const asAdmin = await asActor({ role: "authenticated", userId: fx.userAAdmin }, (c) =>
      c.query("select id, onboarding_completed_at from public.tenants where id = $1", [onboardedTenantId]),
    );
    expect(asAdmin.rows).toHaveLength(1);
    expect(asAdmin.rows[0]?.onboarding_completed_at).not.toBeNull();

    const asManager = await asActor({ role: "authenticated", userId: fx.userAManager }, (c) =>
      c.query("select id from public.tenants where id = $1", [onboardedTenantId]),
    );
    expect(asManager.rows).toHaveLength(1);
  });

  // 2 — não autenticado bloqueado (mesma garantia de onboarding.test.ts, reconfirmada aqui no contexto do painel).
  it("anon cannot read tenant data", async () => {
    const res = await asActor({ role: "anon" }, (c) =>
      c.query("select id from public.tenants where id = $1", [onboardedTenantId]),
    );
    expect(res.rows).toHaveLength(0);
  });

  // 5/6 — sem tenant nenhum / sem membership não acessa nenhum tenant.
  it("a user with no membership anywhere resolves to zero tenants", async () => {
    const res = await asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
      c.query(
        `select t.id from public.tenant_members tm
           join public.tenants t on t.id = tm.tenant_id
         where tm.user_id = $1 and tm.status = 'active'`,
        [fx.userOutsider],
      ),
    );
    expect(res.rows).toHaveLength(0);
  });

  // 7 — public.has_permission() nunca confia no tenant_id recebido: checa a membership de verdade.
  it("public.has_permission() returns false for a tenant the caller is not a member of", async () => {
    const res = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("select public.has_permission($1, 'settings.update') as allowed", [onboardedTenantId]),
    );
    expect(res.rows[0]?.allowed).toBe(false);
  });

  it("public.has_permission() returns true for settings.update when the caller actually has it", async () => {
    const res = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select public.has_permission($1, 'settings.update') as allowed", [onboardedTenantId]),
    );
    expect(res.rows[0]?.allowed).toBe(true);
  });

  // 8/9 — não visualiza/altera tenant alheio (IDOR — mesma garantia de onboarding.test.ts, via has_permission desta vez).
  it("cannot alter a tenant belonging to someone else, confirmed via has_permission and via UPDATE", async () => {
    const permCheck = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("select public.has_permission($1, 'settings.update') as allowed", [onboardedTenantId]),
    );
    expect(permCheck.rows[0]?.allowed).toBe(false);

    const updateAttempt = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("update public.tenants set name = 'Sequestrada' where id = $1 returning id", [
        onboardedTenantId,
      ]),
    );
    expect(updateAttempt.rows).toHaveLength(0);
  });

  // 10 — matriz de 5 papéis: só OWNER/ADMIN têm settings.update.
  it("permission matrix: only OWNER and ADMIN have settings.update — MANAGER/OPERATOR/SUPPORT do not", async () => {
    const cases: [string, boolean][] = [
      [fx.userAOwner, true],
      [fx.userAAdmin, true],
      [fx.userAManager, false],
      [userAOperator, false],
      [userASupport, false],
    ];

    for (const [userId, expected] of cases) {
      const res = await asActor({ role: "authenticated", userId }, (c) =>
        c.query("select public.has_permission($1, 'settings.update') as allowed", [onboardedTenantId]),
      );
      expect(res.rows[0]?.allowed).toBe(expected);
    }
  });

  // 11 — role não pode ser manipulada pelo frontend (proteção da Etapa 2,
  // reconfirmada no contexto do painel). A policy de UPDATE de
  // tenant_members já exclui `user_id = auth.uid()` do USING, então a
  // linha nem fica visível para o próprio UPDATE (0 linhas afetadas, sem
  // erro) — mesma asserção usada em rls-isolation.test.ts (Etapa 2) para
  // este cenário; o trigger prevent_self_role_change é a camada
  // redundante para o caso de a policy um dia mudar.
  it("a member still cannot change their own role (Etapa 2 protection intact)", async () => {
    const result = await asActor({ role: "authenticated", userId: fx.userAManager }, (c) =>
      c.query("update public.tenant_members set role_id = $1 where tenant_id = $2 and user_id = $3", [
        fx.roleIds.OWNER,
        onboardedTenantId,
        fx.userAManager,
      ]),
    );
    expect(result.rowCount).toBe(0);

    const stillManager = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query(
        "select r.key from public.tenant_members tm join public.roles r on r.id = tm.role_id where tm.tenant_id = $1 and tm.user_id = $2",
        [onboardedTenantId, fx.userAManager],
      ),
    );
    expect(stillManager.rows[0]?.key).toBe("MANAGER");
  });

  // 14/15 — dados da loja exibidos corretamente e alterações válidas persistem.
  it("valid settings changes persist and are readable back", async () => {
    const saved = await saveSettings(fx.userAOwner, onboardedTenantId, { storeName: "Loja Nova" }, { commit: true });
    expect(saved.rows[0]?.name).toBe("Loja Nova");
    // onboarding_completed_at não é tocado por esta Action.
    expect(saved.rows[0]?.onboarding_completed_at).not.toBeNull();

    const readBack = await asActor({ role: "authenticated", userId: fx.userAAdmin }, (c) =>
      c.query("select name, segment, contact_email from public.tenants where id = $1", [onboardedTenantId]),
    );
    expect(readBack.rows[0]?.name).toBe("Loja Nova");
    expect(readBack.rows[0]?.segment).toBe("electronics");
    expect(readBack.rows[0]?.contact_email).toBe("novo@loja.com.br");
  });

  // TENANT_SETTINGS_UPDATED — evento novo desta etapa, dispara na mudança real...
  it("editing store settings after onboarding logs TENANT_SETTINGS_UPDATED exactly once", async () => {
    const created = await asActor(
      { role: "authenticated", userId: fx.userBOwner },
      (c) => c.query("select * from public.create_tenant($1, $2)", ["Loja Configs", `loja-configs-${runId}`]),
      { commit: true },
    );
    const tenantId = created.rows[0]?.id as string;
    await withSuperuser((client) =>
      client.query("update public.tenants set onboarding_completed_at = now() where id = $1", [tenantId]),
    );

    await saveSettings(fx.userBOwner, tenantId, {}, { commit: true });

    const events = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query(
        "select action from public.audit_logs where tenant_id = $1 and action = 'TENANT_SETTINGS_UPDATED'",
        [tenantId],
      ),
    );
    expect(events.rows).toHaveLength(1);
  });

  // 17 — ...e double submit (mesmos valores) não duplica o evento.
  it("double-submitting identical settings does not duplicate the audit event", async () => {
    const created = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("select * from public.create_tenant($1, $2)", ["Loja Dupla Config", `loja-dupla-config-${runId}`]),
      { commit: true },
    );
    const tenantId = created.rows[0]?.id as string;
    await withSuperuser((client) =>
      client.query("update public.tenants set onboarding_completed_at = now() where id = $1", [tenantId]),
    );

    await saveSettings(fx.userAOwner, tenantId, { storeName: "Repetida" }, { commit: true });
    await saveSettings(fx.userAOwner, tenantId, { storeName: "Repetida" }, { commit: true }); // reenvio idêntico

    const events = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query(
        "select id from public.audit_logs where tenant_id = $1 and action = 'TENANT_SETTINGS_UPDATED'",
        [tenantId],
      ),
    );
    expect(events.rows).toHaveLength(1); // não duplica

    const rows = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select id from public.tenants where id = $1", [tenantId]),
    );
    expect(rows.rows).toHaveLength(1); // nenhuma linha duplicada
  });

  // Confirma que a mesma transição já coberta pela Etapa 4 continua gerando
  // só TENANT_ONBOARDING_COMPLETED, não os dois eventos ao mesmo tempo.
  it("completing onboarding still logs only TENANT_ONBOARDING_COMPLETED, not TENANT_SETTINGS_UPDATED too", async () => {
    const created = await asActor(
      { role: "authenticated", userId: fx.userBOwner },
      (c) => c.query("select * from public.create_tenant($1, $2)", ["Loja Onboarding Unico", `loja-onboarding-unico-${runId}`]),
      { commit: true },
    );
    const tenantId = created.rows[0]?.id as string;

    await asActor(
      { role: "authenticated", userId: fx.userBOwner },
      (c) =>
        c.query(
          `update public.tenants
             set name = $1, segment = $2, description = $3,
                 instagram_handle = $4, whatsapp_phone = $5, contact_email = $6,
                 onboarding_completed_at = now()
           where id = $7`,
          ["Loja Recem Criada", "apparel", null, "handle", "11999990000", "a@b.com", tenantId],
        ),
      { commit: true },
    );

    const events = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("select action from public.audit_logs where tenant_id = $1 order by created_at", [tenantId]),
    );
    const actions = events.rows.map((r) => r.action as string);
    expect(actions).toContain("TENANT_ONBOARDING_COMPLETED");
    expect(actions).not.toContain("TENANT_SETTINGS_UPDATED");
  });

  // Item explícito da revisão de segurança (§13 Etapa 5): "acesso com
  // membership removida". is_tenant_member() (Etapa 2) e
  // resolveActiveTenantForUser (Etapa 5) só reconhecem status = 'active'
  // — desativar a membership (sem apagar a linha, mesmo modelo usado para
  // remoção que a Etapa 2 já usa) tira o acesso imediatamente, sem
  // depender de nenhum estado de sessão ser invalidado.
  it("a member whose membership was deactivated loses access immediately", async () => {
    const stillActive = await asActor({ role: "authenticated", userId: userAOperator }, (c) =>
      c.query("select id from public.tenants where id = $1", [onboardedTenantId]),
    );
    expect(stillActive.rows).toHaveLength(1);

    await withSuperuser((client) =>
      client.query(
        "update public.tenant_members set status = 'removed' where tenant_id = $1 and user_id = $2",
        [onboardedTenantId, userAOperator],
      ),
    );

    const afterRemoval = await asActor({ role: "authenticated", userId: userAOperator }, (c) =>
      c.query("select id from public.tenants where id = $1", [onboardedTenantId]),
    );
    expect(afterRemoval.rows).toHaveLength(0);
  });
});
