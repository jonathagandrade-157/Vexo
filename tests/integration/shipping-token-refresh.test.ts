/**
 * D3.2-B Ponto 1B — renovação de token do Melhor Envio: camada de banco
 * (migration 20260817220088). A lógica de decisão de
 * `ensureFreshMelhorEnvioToken` já é testada com mocks em
 * tests/unit/shipping-token-refresh.test.ts — aqui o foco é o que só um
 * Postgres real pode provar: a reivindicação do lease é atômica sob
 * concorrência de verdade (duas transações reais, não dois mocks),
 * `store_shipping_credentials` limpa o lease ao gravar com sucesso, e
 * tenant A nunca reivindica/lê/libera o lease de tenant B.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Renovação de token do Melhor Envio (D3.2-B Ponto 1B)", () => {
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await buildFixtures();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedCredentials(
    tenantId: string,
    opts: { expiresInSeconds: number; refreshExpiresInSeconds?: number | null; accessToken?: string; refreshToken?: string },
  ) {
    const { expiresInSeconds, refreshExpiresInSeconds = 45 * 24 * 60 * 60, accessToken = "at", refreshToken = "rt" } = opts;
    await withSuperuser((c) =>
      c.query(
        `select private.store_shipping_credentials($1, 'melhor_envio', $2, $3, now() + make_interval(secs => $4), ${
          refreshExpiresInSeconds === null ? "null" : "now() + make_interval(secs => $5)"
        })`,
        refreshExpiresInSeconds === null
          ? [tenantId, accessToken, refreshToken, expiresInSeconds]
          : [tenantId, accessToken, refreshToken, expiresInSeconds, refreshExpiresInSeconds],
      ),
    );
  }

  async function cleanup(tenantId: string) {
    await withSuperuser((c) => c.query("delete from public.shipping_credentials_vault where tenant_id = $1", [tenantId]));
  }

  it("token bem dentro da margem: not_needed, nunca reivindica o lease", async () => {
    await seedCredentials(fx.tenantA, { expiresInSeconds: 3600 });
    const result = await asActor({ role: "service_role" }, (c) =>
      c.query("select claimed, reason from private.acquire_shipping_credentials_refresh_lease($1, 'melhor_envio', 60, 60)", [fx.tenantA]),
    );
    expect(result.rows[0]).toMatchObject({ claimed: false, reason: "not_needed" });
    await cleanup(fx.tenantA);
  });

  it("token dentro da margem: claimed=true, devolve o refresh_token decifrado", async () => {
    await seedCredentials(fx.tenantA, { expiresInSeconds: 10, refreshToken: "the-real-refresh-token" });
    const result = await asActor({ role: "service_role" }, (c) =>
      c.query<{ claimed: boolean; reason: string; refresh_token: string }>(
        "select claimed, reason, refresh_token from private.acquire_shipping_credentials_refresh_lease($1, 'melhor_envio', 3600, 60)",
        [fx.tenantA],
      ),
    );
    expect(result.rows[0]).toMatchObject({ claimed: true, reason: "claimed", refresh_token: "the-real-refresh-token" });
    await cleanup(fx.tenantA);
  });

  it("concorrência real: duas reivindicações simultâneas (Promise.all, duas conexões/transações reais) — só UMA ganha", async () => {
    await seedCredentials(fx.tenantA, { expiresInSeconds: 10 });

    // commit:true nos dois — sem isso, `asActor` faz rollback ao final de
    // cada chamada, e a exclusão mútua deixaria de ser observável (a
    // segunda transação só respeita o lock de linha da primeira até o
    // COMMIT/ROLLBACK dela; se a primeira desfizer a claim, a segunda
    // enxergaria o estado original e também "ganharia").
    const [first, second] = await Promise.all([
      asActor(
        { role: "service_role" },
        (c) => c.query<{ claimed: boolean }>("select claimed from private.acquire_shipping_credentials_refresh_lease($1, 'melhor_envio', 3600, 60)", [fx.tenantA]),
        { commit: true },
      ),
      asActor(
        { role: "service_role" },
        (c) => c.query<{ claimed: boolean }>("select claimed from private.acquire_shipping_credentials_refresh_lease($1, 'melhor_envio', 3600, 60)", [fx.tenantA]),
        { commit: true },
      ),
    ]);

    const claims = [first.rows[0]!.claimed, second.rows[0]!.claimed];
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.filter((c) => !c)).toHaveLength(1);
    await cleanup(fx.tenantA);
  });

  it("lease expira sozinho após o prazo — uma segunda reivindicação depois do lease vencer é aceita mesmo sem release explícito", async () => {
    await seedCredentials(fx.tenantA, { expiresInSeconds: 10 });
    const claimed1 = await asActor(
      { role: "service_role" },
      (c) => c.query<{ claimed: boolean }>("select claimed from private.acquire_shipping_credentials_refresh_lease($1, 'melhor_envio', 3600, 0)", [fx.tenantA]),
      { commit: true },
    );
    expect(claimed1.rows[0]!.claimed).toBe(true);

    // p_lease_seconds=0 significa que o lease já é considerado expirado
    // no instante seguinte — simula o processo que reivindicou ter
    // morrido sem liberar.
    const claimed2 = await asActor({ role: "service_role" }, (c) =>
      c.query<{ claimed: boolean }>("select claimed from private.acquire_shipping_credentials_refresh_lease($1, 'melhor_envio', 3600, 0)", [fx.tenantA]),
    );
    expect(claimed2.rows[0]!.claimed).toBe(true);
    await cleanup(fx.tenantA);
  });

  it("release libera o lease explicitamente, permitindo nova reivindicação imediata", async () => {
    await seedCredentials(fx.tenantA, { expiresInSeconds: 10 });
    await asActor(
      { role: "service_role" },
      (c) => c.query("select private.acquire_shipping_credentials_refresh_lease($1, 'melhor_envio', 3600, 3600)", [fx.tenantA]),
      { commit: true },
    );

    const beforeRelease = await asActor({ role: "service_role" }, (c) =>
      c.query<{ claimed: boolean; reason: string }>("select claimed, reason from private.acquire_shipping_credentials_refresh_lease($1, 'melhor_envio', 3600, 3600)", [fx.tenantA]),
    );
    expect(beforeRelease.rows[0]).toMatchObject({ claimed: false, reason: "already_refreshing" });

    await asActor(
      { role: "service_role" },
      (c) => c.query("select private.release_shipping_credentials_refresh_lease($1, 'melhor_envio')", [fx.tenantA]),
      { commit: true },
    );

    const afterRelease = await asActor({ role: "service_role" }, (c) =>
      c.query<{ claimed: boolean }>("select claimed from private.acquire_shipping_credentials_refresh_lease($1, 'melhor_envio', 3600, 3600)", [fx.tenantA]),
    );
    expect(afterRelease.rows[0]!.claimed).toBe(true);
    await cleanup(fx.tenantA);
  });

  it("store_shipping_credentials (renovação bem-sucedida) limpa o lease automaticamente", async () => {
    await seedCredentials(fx.tenantA, { expiresInSeconds: 10 });
    await asActor(
      { role: "service_role" },
      (c) => c.query("select private.acquire_shipping_credentials_refresh_lease($1, 'melhor_envio', 3600, 3600)", [fx.tenantA]),
      { commit: true },
    );

    const locked = await withSuperuser((c) =>
      c.query<{ refresh_locked_at: Date | null }>("select refresh_locked_at from public.shipping_credentials_vault where tenant_id = $1", [fx.tenantA]),
    );
    expect(locked.rows[0]!.refresh_locked_at).not.toBeNull();

    await asActor(
      { role: "service_role" },
      (c) => c.query("select private.store_shipping_credentials($1, 'melhor_envio', 'new-at', 'new-rt', now() + interval '30 days', now() + interval '45 days')", [fx.tenantA]),
      { commit: true },
    );

    const unlocked = await withSuperuser((c) =>
      c.query<{ refresh_locked_at: Date | null }>("select refresh_locked_at from public.shipping_credentials_vault where tenant_id = $1", [fx.tenantA]),
    );
    expect(unlocked.rows[0]!.refresh_locked_at).toBeNull();
    await cleanup(fx.tenantA);
  });

  it("multi-tenant: reivindicar/liberar o lease do tenant A nunca afeta o lease do tenant B", async () => {
    await seedCredentials(fx.tenantA, { expiresInSeconds: 10 });
    await seedCredentials(fx.tenantB, { expiresInSeconds: 10 });

    await asActor(
      { role: "service_role" },
      (c) => c.query("select private.acquire_shipping_credentials_refresh_lease($1, 'melhor_envio', 3600, 3600)", [fx.tenantA]),
      { commit: true },
    );

    // Tenant B continua livre — a reivindicação de A não bloqueou B.
    const claimB = await asActor(
      { role: "service_role" },
      (c) =>
        c.query<{ claimed: boolean; refresh_token: string }>(
          "select claimed, refresh_token from private.acquire_shipping_credentials_refresh_lease($1, 'melhor_envio', 3600, 3600)",
          [fx.tenantB],
        ),
      { commit: true },
    );
    expect(claimB.rows[0]).toMatchObject({ claimed: true, refresh_token: "rt" });

    await asActor(
      { role: "service_role" },
      (c) => c.query("select private.release_shipping_credentials_refresh_lease($1, 'melhor_envio')", [fx.tenantB]),
      { commit: true },
    );

    // A ainda está travado (o release de B não vazou para A).
    const stillLockedA = await asActor({ role: "service_role" }, (c) =>
      c.query<{ claimed: boolean; reason: string }>("select claimed, reason from private.acquire_shipping_credentials_refresh_lease($1, 'melhor_envio', 3600, 3600)", [fx.tenantA]),
    );
    expect(stillLockedA.rows[0]).toMatchObject({ claimed: false, reason: "already_refreshing" });

    await cleanup(fx.tenantA);
    await cleanup(fx.tenantB);
  });

  it("multi-tenant: get/store/delete_shipping_credentials permanecem escopados — a renovação de A nunca lê/edita o token de B", async () => {
    await seedCredentials(fx.tenantA, { expiresInSeconds: 10, accessToken: "at-a", refreshToken: "rt-a" });
    await seedCredentials(fx.tenantB, { expiresInSeconds: 3600, accessToken: "at-b", refreshToken: "rt-b" });

    await asActor(
      { role: "service_role" },
      (c) => c.query("select private.store_shipping_credentials($1, 'melhor_envio', 'at-a-renewed', 'rt-a-renewed', now() + interval '30 days', now() + interval '45 days')", [fx.tenantA]),
      { commit: true },
    );

    const bUnchanged = await asActor({ role: "service_role" }, (c) =>
      c.query<{ access_token: string; refresh_token: string }>("select access_token, refresh_token from private.get_shipping_credentials($1, 'melhor_envio')", [fx.tenantB]),
    );
    expect(bUnchanged.rows[0]).toEqual({ access_token: "at-b", refresh_token: "rt-b" });

    await cleanup(fx.tenantA);
    await cleanup(fx.tenantB);
  });

  it("anon/authenticated não têm execute nas funções de lease (mesmo desenho service_role-only do vault)", async () => {
    const anonErr = await asActor({ role: "anon" }, (c) =>
      c.query("select private.acquire_shipping_credentials_refresh_lease($1, 'melhor_envio', 3600, 60)", [fx.tenantA]),
    ).catch((err: Error) => err);
    expect(anonErr).toBeInstanceOf(Error);
    expect((anonErr as Error).message).toMatch(/permission denied/i);

    const authErr = await asActor({ role: "authenticated", userId: fx.userAOwner }, (c) =>
      c.query("select private.release_shipping_credentials_refresh_lease($1, 'melhor_envio')", [fx.tenantA]),
    ).catch((err: Error) => err);
    expect(authErr).toBeInstanceOf(Error);
    expect((authErr as Error).message).toMatch(/permission denied/i);
  });
});
