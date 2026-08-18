/**
 * Etapa 3 — testes de elegibilidade de trial (arquitetura §13, §25.1).
 *
 * Mesmo harness da Etapa 2 (Postgres real + stub, ver
 * tests/integration/fixtures/supabase-stub.sql). Cobre exatamente os
 * cenários pedidos: usuário elegível, usuário não elegível (mesmo
 * documento reutilizado), e tentativas de manipular a requisição para
 * obter um segundo trial (tenant de outra pessoa, chamada duplicada, e —
 * o mais importante — chamar a função diretamente como `authenticated`,
 * pulando a Server Action que calcula o hash de verdade).
 *
 * public.start_trial_for_tenant() é service_role-only (ver o comentário
 * no início da migration 20260817220017 para o porquê); os testes por
 * isso chamam como `{ role: "service_role" }`, com `p_user_id` explícito
 * — exatamente como features/auth/actions.ts faz depois de já ter
 * validado a sessão via supabase.auth.getUser().
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

function fakeHash(seed: string): string {
  return `hash-${seed}-${Math.random().toString(36).slice(2, 10)}`;
}

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)(
  "Trial eligibility (Etapa 3)",
  () => {
    let fx: Fixtures;

    beforeAll(async () => {
      fx = await buildFixtures();
    });

    afterAll(async () => {
      await pool.end();
    });

    it("an eligible user starts a trial for the tenant they created", async () => {
      const documentHash = fakeHash("eligible-owner");
      const created = await asActor(
        { role: "authenticated", userId: fx.userOutsider },
        (c) => c.query("select * from public.create_tenant($1, $2)", ["Loja Elegível", "loja-elegivel"]),
        { commit: true },
      );
      const tenantId = created.rows[0]?.id as string;

      const trial = await asActor(
        { role: "service_role" },
        (c) =>
          c.query("select * from public.start_trial_for_tenant($1, $2, $3)", [
            fx.userOutsider,
            tenantId,
            documentHash,
          ]),
        { commit: true },
      );
      expect(trial.rows[0]?.status).toBe("active");
      expect(trial.rows[0]?.tenant_id).toBe(tenantId);

      // ends_at é ~30 dias depois de started_at.
      const startedAt = new Date(trial.rows[0]?.started_at as string).getTime();
      const endsAt = new Date(trial.rows[0]?.ends_at as string).getTime();
      const days = (endsAt - startedAt) / (1000 * 60 * 60 * 24);
      expect(days).toBeCloseTo(30, 1);

      // trial_eligibility foi gravada com o hash (verificado indiretamente:
      // uma segunda tentativa com o mesmo hash é bloqueada — próximo teste).
    });

    it("a second signup with the same document hash is blocked (not eligible)", async () => {
      const documentHash = fakeHash("reused-document");

      const firstTenant = await asActor(
        { role: "authenticated", userId: fx.userAManager },
        (c) => c.query("select * from public.create_tenant($1, $2)", ["Primeira Loja", "primeira-loja"]),
        { commit: true },
      );
      await asActor(
        { role: "service_role" },
        (c) =>
          c.query("select * from public.start_trial_for_tenant($1, $2, $3)", [
            fx.userAManager,
            firstTenant.rows[0]?.id,
            documentHash,
          ]),
        { commit: true },
      );

      // Uma pessoa DIFERENTE (conta diferente) tenta usar o mesmo documento
      // para um SEGUNDO tenant — deve ser bloqueada com TRIAL_ALREADY_USED.
      const secondTenant = await asActor(
        { role: "authenticated", userId: fx.userBOwner },
        (c) => c.query("select * from public.create_tenant($1, $2)", ["Segunda Loja", "segunda-loja"]),
        { commit: true },
      );

      const err = await expectPgError(
        asActor({ role: "service_role" }, (c) =>
          c.query("select * from public.start_trial_for_tenant($1, $2, $3)", [
            fx.userBOwner,
            secondTenant.rows[0]?.id,
            documentHash,
          ]),
        ),
      );
      expect(err.message).toMatch(/TRIAL_ALREADY_USED/);
      expect((err as unknown as { code?: string }).code).toBe("VX001");

      // O segundo tenant não ganhou trial_records.
      const trialRows = await asActor(
        { role: "authenticated", userId: fx.userBOwner },
        (c) =>
          c.query("select id from public.trial_records where tenant_id = $1", [
            secondTenant.rows[0]?.id,
          ]),
      );
      expect(trialRows.rows).toHaveLength(0);
    });

    it("cannot start a trial for a tenant created by someone else (request tampering)", async () => {
      const created = await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("select * from public.create_tenant($1, $2)", ["Loja Do Owner A", "loja-owner-a-2"]),
        { commit: true },
      );
      const tenantId = created.rows[0]?.id as string;

      // Mesmo confiável (service_role), a função rejeita se p_user_id não
      // bate com quem de fato criou o tenant — prova que a checagem é
      // feita dentro da função, não apenas "confiada" por ser service_role.
      const err = await expectPgError(
        asActor({ role: "service_role" }, (c) =>
          c.query("select * from public.start_trial_for_tenant($1, $2, $3)", [
            fx.userOutsider,
            tenantId,
            fakeHash("tampering-attempt"),
          ]),
        ),
      );
      expect(err.message).toMatch(/caller did not create this tenant/);
    });

    it("cannot start a second trial for the same tenant (double-claim)", async () => {
      const created = await asActor(
        { role: "authenticated", userId: fx.userBOwner },
        (c) => c.query("select * from public.create_tenant($1, $2)", ["Loja Dupla", "loja-dupla"]),
        { commit: true },
      );
      const tenantId = created.rows[0]?.id as string;

      await asActor(
        { role: "service_role" },
        (c) =>
          c.query("select * from public.start_trial_for_tenant($1, $2, $3)", [
            fx.userBOwner,
            tenantId,
            fakeHash("first-claim"),
          ]),
        { commit: true },
      );

      const err = await expectPgError(
        asActor({ role: "service_role" }, (c) =>
          c.query("select * from public.start_trial_for_tenant($1, $2, $3)", [
            fx.userBOwner,
            tenantId,
            fakeHash("second-claim-different-hash"),
          ]),
        ),
      );
      expect(err.message).toMatch(/already has a trial record/);
    });

    // Este é o cenário mais importante de "manipular a requisição para
    // obter um segundo trial": pular a Server Action inteira e chamar a
    // função diretamente via RPC como usuário comum, com um hash
    // inventado na hora (nunca precisando fornecer um CPF/CNPJ real).
    // Bloqueado por privilégio (REVOKE), não apenas por lógica de negócio.
    it("authenticated cannot call start_trial_for_tenant directly (bypassing the real hash computation)", async () => {
      const created = await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("select * from public.create_tenant($1, $2)", ["Loja Blindada", "loja-blindada"]),
        { commit: true },
      );
      const tenantId = created.rows[0]?.id as string;

      const err = await expectPgError(
        asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
          c.query("select * from public.start_trial_for_tenant($1, $2, $3)", [
            fx.userAOwner,
            tenantId,
            "qualquer-string-inventada-sem-cpf-nenhum",
          ]),
        ),
      );
      expect(err.message).toMatch(/permission denied/i);
    });

    it("trial_eligibility is not readable or writable directly by authenticated or anon", async () => {
      const asAuth = await expectPgError(
        asActor({ role: "authenticated", userId: fx.userOutsider }, (c) =>
          c.query("select * from public.trial_eligibility limit 1"),
        ),
      );
      expect(asAuth.message).toMatch(/permission denied/i);

      const asAnon = await expectPgError(
        asActor({ role: "anon" }, (c) => c.query("select * from public.trial_eligibility limit 1")),
      );
      expect(asAnon.message).toMatch(/permission denied/i);
    });

    it("only tenant members (or platform admins) can read a tenant's trial_records", async () => {
      const created = await asActor(
        { role: "authenticated", userId: fx.userAAdmin },
        (c) => c.query("select * from public.create_tenant($1, $2)", ["Loja Privada", "loja-privada"]),
        { commit: true },
      );
      const tenantId = created.rows[0]?.id as string;
      await asActor(
        { role: "service_role" },
        (c) =>
          c.query("select * from public.start_trial_for_tenant($1, $2, $3)", [
            fx.userAAdmin,
            tenantId,
            fakeHash("private-trial"),
          ]),
        { commit: true },
      );

      const outsiderView = await asActor(
        { role: "authenticated", userId: fx.userOutsider },
        (c) => c.query("select id from public.trial_records where tenant_id = $1", [tenantId]),
      );
      expect(outsiderView.rows).toHaveLength(0);

      const masterView = await asActor(
        { role: "authenticated", userId: fx.userMaster },
        (c) => c.query("select id from public.trial_records where tenant_id = $1", [tenantId]),
      );
      expect(masterView.rows).toHaveLength(1);
    });
  },
);
