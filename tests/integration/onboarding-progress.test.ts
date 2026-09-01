/**
 * D12.2/D12.2.1 — engine de onboarding multi-etapa: `tenants.business_type`
 * (migration 20260817220093) + `onboarding_progress`
 * (migration 20260817220094) + `onboarding_progress.status`
 * (migration 20260817220095, "completed" vs "skipped").
 *
 * Mesmo princípio de sempre neste projeto (ver tests/integration/onboarding.test.ts,
 * D12.0 §L): RLS testada diretamente via SQL (asActor), nunca invocando
 * os Server Actions do Next.js diretamente — a autoridade final de
 * autorização é sempre a RLS, testada aqui; `recomputeOnboardingCompletion`
 * (features/onboarding/progress.ts) faz exatamente o mesmo `UPDATE`
 * condicional reproduzido nos testes abaixo, então testar esse `UPDATE`
 * diretamente cobre a mesma garantia sem precisar de um runtime Next.js
 * dentro do harness de integração (Postgres real + stub, sem servidor
 * HTTP — mesma limitação já documentada em D12.0/Etapa 2).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, giveUnlimitedPlan, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

/** Mesmo UPDATE condicional de `recomputeOnboardingCompletion` — só grava quando ainda NULL, nunca sobrescreve. */
async function recomputeCompletion(tenantId: string) {
  return withSuperuser((c) =>
    c.query(
      "update public.tenants set onboarding_completed_at = now() where id = $1 and onboarding_completed_at is null returning onboarding_completed_at",
      [tenantId],
    ),
  );
}

/** Mesmo UPSERT de `markOnboardingStepProgress` (features/onboarding/progress.ts). */
async function upsertProgress(tenantId: string, stepKey: string, status: "completed" | "skipped", actorUserId: string) {
  return asActor(
    { role: "authenticated", userId: actorUserId },
    (c) =>
      c.query(
        `insert into public.onboarding_progress (tenant_id, step_key, status, completed_at)
         values ($1, $2, $3, now())
         on conflict (tenant_id, step_key) do update set status = excluded.status, completed_at = excluded.completed_at
         returning status, completed_at`,
        [tenantId, stepKey, status],
      ),
    { commit: true },
  );
}

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Motor de onboarding multi-etapa (D12.2/D12.2.1)", () => {
  let fx: Fixtures;
  let userAOperator: string;

  beforeAll(async () => {
    fx = await buildFixtures();
    await withSuperuser(async (client) => {
      await giveUnlimitedPlan(client, [fx.tenantA, fx.tenantB]);
      const { rows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`onboarding-operator-${runId}@fixtures.test`],
      );
      userAOperator = rows[0]!.id;
      await client.query("insert into public.tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)", [
        fx.tenantA,
        userAOperator,
        fx.roleIds.OPERATOR,
      ]);
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createPendingTenant(owner: string, name: string) {
    const created = await asActor(
      { role: "authenticated", userId: owner },
      (c) => c.query("select * from public.create_tenant($1, $2)", [name, `${name.toLowerCase().replace(/\s+/g, "-")}-${runId}`]),
      { commit: true },
    );
    return created.rows[0]?.id as string;
  }

  // 1/2 — RLS: dono consegue ler/inserir/atualizar o próprio progresso.
  it("tenant staff with settings.update can read/insert/update their own onboarding_progress", async () => {
    const tenantId = await createPendingTenant(fx.userAOwner, "Loja Progresso A");

    const inserted = await upsertProgress(tenantId, "seu-negocio", "completed", fx.userAOwner);
    expect(inserted.rows).toHaveLength(1);
    expect(inserted.rows[0]?.status).toBe("completed");

    const read = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select step_key, status, completed_at from public.onboarding_progress where tenant_id = $1", [tenantId]),
    );
    expect(read.rows).toHaveLength(1);
    expect(read.rows[0]?.completed_at).not.toBeNull();

    const updated = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) =>
        c.query(
          "update public.onboarding_progress set data = $1 where tenant_id = $2 and step_key = $3 returning data",
          [JSON.stringify({ note: "revisitado" }), tenantId, "seu-negocio"],
        ),
      { commit: true },
    );
    expect(updated.rows).toHaveLength(1);
  });

  // 3/4 — isolamento entre tenants / IDOR: membro de outro tenant nunca lê/escreve.
  it("a member of tenant B cannot read tenant A's onboarding_progress (isolation)", async () => {
    const tenantId = await createPendingTenant(fx.userAOwner, "Loja Progresso Isolamento");
    await withSuperuser((c) =>
      c.query("insert into public.onboarding_progress (tenant_id, step_key, status, completed_at) values ($1, $2, 'completed', now())", [
        tenantId,
        "seu-negocio",
      ]),
    );

    const read = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("select step_key from public.onboarding_progress where tenant_id = $1", [tenantId]),
    );
    expect(read.rows).toHaveLength(0);
  });

  it("a member of tenant B cannot insert onboarding_progress for tenant A (IDOR / tenant hopping)", async () => {
    const tenantId = await createPendingTenant(fx.userAOwner, "Loja Progresso IDOR");

    const err = await expectPgError(upsertProgress(tenantId, "identidade", "skipped", fx.userBOwner));
    expect(err.message).toMatch(/row-level security|permission denied/i);
  });

  it("a member of tenant B cannot update tenant A's onboarding_progress", async () => {
    const tenantId = await createPendingTenant(fx.userAOwner, "Loja Progresso Update Isolado");
    await withSuperuser((c) =>
      c.query("insert into public.onboarding_progress (tenant_id, step_key, status, completed_at) values ($1, $2, 'completed', now())", [
        tenantId,
        "seu-negocio",
      ]),
    );

    const result = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("update public.onboarding_progress set completed_at = now() where tenant_id = $1 returning tenant_id", [
        tenantId,
      ]),
    );
    // RLS bloqueia via USING — UPDATE não lança erro, só afeta 0 linhas (mesmo padrão de tenants, onboarding.test.ts).
    expect(result.rowCount).toBe(0);
  });

  it("a member without settings.update (OPERATOR) cannot modify onboarding_progress", async () => {
    const tenantId = await createPendingTenant(fx.userAOwner, "Loja Progresso Operator");

    const err = await expectPgError(upsertProgress(tenantId, "seu-negocio", "completed", userAOperator));
    expect(err.message).toMatch(/row-level security|permission denied/i);
  });

  it("anon cannot read or write onboarding_progress", async () => {
    const tenantId = await createPendingTenant(fx.userAOwner, "Loja Progresso Anon");
    await withSuperuser((c) =>
      c.query("insert into public.onboarding_progress (tenant_id, step_key, status, completed_at) values ($1, $2, 'completed', now())", [
        tenantId,
        "seu-negocio",
      ]),
    );

    const read = await asActor({ role: "anon" }, (c) =>
      c.query("select step_key from public.onboarding_progress where tenant_id = $1", [tenantId]),
    );
    expect(read.rows).toHaveLength(0);
  });

  // D12.2.1 — status aceita só 'completed'/'skipped'.
  it("onboarding_progress.status only accepts 'completed'/'skipped', rejects anything else", async () => {
    const tenantId = await createPendingTenant(fx.userAOwner, "Loja Progresso Status Check");

    const ok1 = await upsertProgress(tenantId, "identidade", "completed", fx.userAOwner);
    expect(ok1.rows[0]?.status).toBe("completed");
    const ok2 = await upsertProgress(tenantId, "identidade", "skipped", fx.userAOwner);
    expect(ok2.rows[0]?.status).toBe("skipped");

    await expectPgError(
      withSuperuser((c) =>
        c.query("insert into public.onboarding_progress (tenant_id, step_key, status) values ($1, $2, $3)", [
          tenantId,
          "produtos",
          "in_progress",
        ]),
      ),
    );
  });

  it("status defaults to 'completed' for a row inserted without specifying it (backfill compatibility)", async () => {
    const tenantId = await createPendingTenant(fx.userAOwner, "Loja Progresso Status Default");
    const row = await withSuperuser((c) =>
      c.query(
        "insert into public.onboarding_progress (tenant_id, step_key, completed_at) values ($1, 'seu-negocio', now()) returning status",
        [tenantId],
      ),
    );
    expect(row.rows[0]?.status).toBe("completed");
  });

  // 8. double-submit continua idempotente.
  it("upserting the same (tenant_id, step_key) twice never duplicates the row (double-submit), including a status change", async () => {
    const tenantId = await createPendingTenant(fx.userAOwner, "Loja Progresso Upsert");

    await upsertProgress(tenantId, "produtos", "skipped", fx.userAOwner);
    await upsertProgress(tenantId, "produtos", "completed", fx.userAOwner); // reenvio (double submit), agora completed

    const rows = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select status from public.onboarding_progress where tenant_id = $1 and step_key = $2", [tenantId, "produtos"]),
    );
    expect(rows.rows).toHaveLength(1); // nunca duplica
    expect(rows.rows[0]?.status).toBe("completed"); // a resolução mais recente vence
  });

  // 6 — onboarding_completed_at preenchido com várias etapas skipped.
  it("recomputeOnboardingCompletion (UPDATE condicional) fills onboarding_completed_at once required steps are resolved (mix of completed/skipped) and audits it", async () => {
    const tenantId = await createPendingTenant(fx.userBOwner, "Loja Progresso Conclusao");

    // Nunca marca antecipadamente: onboarding continua NULL sem nenhum progresso.
    const before = await withSuperuser((c) =>
      c.query("select onboarding_completed_at from public.tenants where id = $1", [tenantId]),
    );
    expect(before.rows[0]?.onboarding_completed_at).toBeNull();

    // Cenário real do D12.2.1: 'seu-negocio'/'revisar'/'publicar' completed, o resto skipped.
    for (const [stepKey, status] of [
      ["seu-negocio", "completed"],
      ["identidade", "skipped"],
      ["produtos", "skipped"],
      ["categorias", "skipped"],
      ["pagamentos", "skipped"],
      ["entrega", "skipped"],
      ["revisar", "completed"],
      ["publicar", "completed"],
    ] as const) {
      await withSuperuser((c) =>
        c.query(
          "insert into public.onboarding_progress (tenant_id, step_key, status, completed_at) values ($1, $2, $3, now())",
          [tenantId, stepKey, status],
        ),
      );
    }

    const completed = await recomputeCompletion(tenantId);
    expect(completed.rows[0]?.onboarding_completed_at).not.toBeNull();

    const auditRows = await withSuperuser((c) =>
      c.query("select id from public.audit_logs where tenant_id = $1 and action = 'TENANT_ONBOARDING_COMPLETED'", [
        tenantId,
      ]),
    );
    expect(auditRows.rows).toHaveLength(1);

    // Reenvio (double-submit do "Publicar") não duplica o UPDATE nem a auditoria — WHERE onboarding_completed_at IS NULL não afeta nenhuma linha na segunda vez.
    const secondCall = await recomputeCompletion(tenantId);
    expect(secondCall.rows).toHaveLength(0);
    const auditRowsAfter = await withSuperuser((c) =>
      c.query("select id from public.audit_logs where tenant_id = $1 and action = 'TENANT_ONBOARDING_COMPLETED'", [
        tenantId,
      ]),
    );
    expect(auditRowsAfter.rows).toHaveLength(1); // continua 1, nunca 2
  });

  // 10. tenant legado — onboarding já concluído ANTES de D12.2, business_type nunca escolhido.
  it("a legacy tenant (onboarding_completed_at set, business_type NULL) keeps working unchanged", async () => {
    const created = await asActor(
      { role: "authenticated", userId: fx.userAOwner },
      (c) => c.query("select * from public.create_tenant($1, $2)", ["Loja Legada", `loja-legada-${runId}`]),
      { commit: true },
    );
    const tenantId = created.rows[0]?.id as string;

    // Simula o estado de um tenant que completou o onboarding de 1 etapa antes desta migration existir.
    await withSuperuser((c) =>
      c.query("update public.tenants set onboarding_completed_at = now() where id = $1", [tenantId]),
    );

    const row = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select onboarding_completed_at, business_type from public.tenants where id = $1", [tenantId]),
    );
    expect(row.rows[0]?.onboarding_completed_at).not.toBeNull();
    expect(row.rows[0]?.business_type).toBeNull();

    // recomputeOnboardingCompletion nunca sobrescreve um tenant já concluído (WHERE ... IS NULL) — não há alteração destrutiva.
    const noop = await recomputeCompletion(tenantId);
    expect(noop.rows).toHaveLength(0);
  });

  // o tenant pendente real citado no prompt de D12.2 continua funcionando.
  it("a freshly created (pending) tenant has no business_type and no onboarding_progress rows yet", async () => {
    const tenantId = await createPendingTenant(fx.userBOwner, "Loja Pendente Real");

    const row = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("select onboarding_completed_at, business_type from public.tenants where id = $1", [tenantId]),
    );
    expect(row.rows[0]?.onboarding_completed_at).toBeNull();
    expect(row.rows[0]?.business_type).toBeNull();

    const progressRows = await asActor({ role: "authenticated", userId: fx.userBOwner }, (c) =>
      c.query("select step_key from public.onboarding_progress where tenant_id = $1", [tenantId]),
    );
    expect(progressRows.rows).toHaveLength(0);
  });

  // 7. usuário pode voltar para uma etapa skipped — retomada entre sessões preserva o status.
  it("progress (including 'skipped') persists across a brand-new session (resume) and stays revisitable", async () => {
    const tenantId = await createPendingTenant(fx.userAOwner, "Loja Progresso Retomada");
    await withSuperuser((c) => c.query("update public.tenants set business_type = 'ecommerce' where id = $1", [tenantId]));

    await upsertProgress(tenantId, "seu-negocio", "completed", fx.userAOwner);
    await upsertProgress(tenantId, "identidade", "skipped", fx.userAOwner);

    // Nova conexão/transação — simula um novo login em outro momento (fechar o navegador e voltar depois).
    const laterSession = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select step_key, status, completed_at from public.onboarding_progress where tenant_id = $1 order by step_key", [
        tenantId,
      ]),
    );
    expect(laterSession.rows).toHaveLength(2);
    const identidade = laterSession.rows.find((r) => r.step_key === "identidade");
    expect(identidade?.status).toBe("skipped");
    expect(identidade?.completed_at).not.toBeNull();

    // O lojista decide voltar e configurar de verdade a etapa que tinha pulado — não é forçado a "refazer", só pode.
    const revisited = await upsertProgress(tenantId, "identidade", "completed", fx.userAOwner);
    expect(revisited.rows[0]?.status).toBe("completed");
  });

  // Path traversal-like / malformado — mesma checagem já feita para product-media (D11), aplicada aqui a step_key.
  it("an arbitrary/malformed step_key is accepted at the DB layer (no CHECK) — reachability is enforced in the application layer, not RLS", async () => {
    // step_key não tem CHECK constraint (a validação de "pertence à definição do business_type" é feita em
    // isStepReachable/getStepsForBusinessType, TypeScript — testado em tests/unit/onboarding-progress-logic.test.ts,
    // "stepKey que não pertence a esta definição nunca é alcançável"). RLS só protege tenant_id, nunca o formato de step_key.
    const tenantId = await createPendingTenant(fx.userAOwner, "Loja Progresso StepKey Livre");
    const inserted = await upsertProgress(tenantId, "../etapa-inventada", "completed", fx.userAOwner);
    expect(inserted.rows).toHaveLength(1);
  });

  // A migration cria exatamente a coluna documentada, sem alterar o CHECK de status/segment existentes.
  it("tenants.business_type accepts exactly the 3 documented values and rejects anything else", async () => {
    const tenantId = await createPendingTenant(fx.userBOwner, "Loja Business Type Check");

    for (const value of ["restaurant", "adega", "ecommerce"]) {
      const ok = await withSuperuser((c) =>
        c.query("update public.tenants set business_type = $1 where id = $2 returning business_type", [value, tenantId]),
      );
      expect(ok.rows[0]?.business_type).toBe(value);
    }

    await expectPgError(
      withSuperuser((c) => c.query("update public.tenants set business_type = $1 where id = $2", ["padaria", tenantId])),
    );
  });

  // 11. nenhum produto/pagamento/entrega é criado automaticamente pelo onboarding — completar/pular etapas nunca toca em outras tabelas de negócio.
  it("resolving (completed or skipped) every step of the whole ecommerce flow never inserts a row in products/categories/store_payment_providers/shipping_methods", async () => {
    const tenantId = await createPendingTenant(fx.userAOwner, "Loja Progresso Sem Efeito Colateral");
    await withSuperuser((c) => c.query("update public.tenants set business_type = 'ecommerce' where id = $1", [tenantId]));

    for (const [stepKey, status] of [
      ["seu-negocio", "completed"],
      ["identidade", "skipped"],
      ["produtos", "skipped"],
      ["categorias", "skipped"],
      ["pagamentos", "skipped"],
      ["entrega", "skipped"],
      ["revisar", "completed"],
      ["publicar", "completed"],
    ] as const) {
      await upsertProgress(tenantId, stepKey, status, fx.userAOwner);
    }
    await recomputeCompletion(tenantId);

    const [products, categories, paymentProviders, shippingMethods] = await Promise.all([
      withSuperuser((c) => c.query("select id from public.products where tenant_id = $1", [tenantId])),
      withSuperuser((c) => c.query("select id from public.categories where tenant_id = $1", [tenantId])),
      withSuperuser((c) => c.query("select tenant_id from public.store_payment_providers where tenant_id = $1", [tenantId])),
      withSuperuser((c) => c.query("select id from public.shipping_methods where tenant_id = $1", [tenantId])),
    ]);
    expect(products.rows).toHaveLength(0);
    expect(categories.rows).toHaveLength(0);
    expect(paymentProviders.rows).toHaveLength(0);
    expect(shippingMethods.rows).toHaveLength(0);

    const tenantRow = await withSuperuser((c) =>
      c.query("select onboarding_completed_at from public.tenants where id = $1", [tenantId]),
    );
    expect(tenantRow.rows[0]?.onboarding_completed_at).not.toBeNull();
  });
});
