/**
 * D18.6.2 — isolamento cross-tenant do checklist "Configure sua loja"
 * (D12.2.2: components/painel/store-setup-checklist.tsx,
 * features/painel/store-setup.ts, features/painel/store-setup-logic.ts).
 *
 * Única lacuna real identificada em D18.6.1 (discovery): não havia teste
 * de integração confirmando que `resolveStoreSetupChecklist` nunca mistura
 * o estado de dois tenants. Mesmo princípio de todo o resto desta suíte
 * (ver tests/integration/history.test.ts, tests/integration/onboarding-progress.test.ts):
 * SQL direto via `asActor`, nunca chamando `features/painel/store-setup.ts`
 * diretamente — essa função recebe um `SupabaseClient` real de sessão
 * (`@supabase/supabase-js` contra PostgREST), que não existe neste harness
 * (só Postgres cru via `pg`). As 6 queries abaixo são exatamente as 6 de
 * `resolveStoreSetupChecklist` (mesma tabela, mesmas colunas, mesmos
 * filtros por `tenant_id`) — reproduzi-las aqui exercita a mesma garantia
 * de isolamento (RLS real, sem service_role) sem precisar de um runtime
 * Next.js.
 *
 * `buildStoreSetupChecklist` (features/painel/store-setup-logic.ts) é
 * função pura — sem Supabase, sem `next/headers` — o mesmo import já usado
 * por tests/unit/store-setup-checklist.test.ts. Importá-la aqui é seguro e
 * permite verificar, além do isolamento bruto por linha, que o checklist
 * final (produzido pelo mesmo código de produção) também nunca mistura
 * sinais dos dois tenants.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, giveUnlimitedPlan, type Fixtures } from "./helpers/fixtures";
import { buildStoreSetupChecklist, type StoreSetupRawSignals } from "@/features/painel/store-setup-logic";

const runId = randomUUID().slice(0, 8);

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Configure sua loja — isolamento cross-tenant (D18.6.2)", () => {
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await buildFixtures();

    await withSuperuser(async (client) => {
      await giveUnlimitedPlan(client, [fx.tenantA, fx.tenantB]);

      // Tenant A: as 6 condições do checklist satisfeitas de propósito —
      // é o único tenant configurado. Tenant B fica intencionalmente vazio
      // (nenhum UPDATE/INSERT abaixo o toca), exatamente o contraste que
      // este arquivo precisa para provar isolamento.
      await client.query(
        `update public.tenants
         set name = $1, segment = 'apparel', instagram_handle = '@lojaa', whatsapp_phone = '11999990000',
             contact_email = 'contato-a@example.com', logo_url = $2
         where id = $3`,
        [`Loja A Completa ${runId}`, `${fx.tenantA}/logo/logo.png`, fx.tenantA],
      );

      const { rows: catA } = await client.query<{ id: string }>(
        "insert into public.categories (tenant_id, name, slug) values ($1, $2, $3) returning id",
        [fx.tenantA, "Categoria A", `categoria-a-${runId}`],
      );
      await client.query(
        "insert into public.products (tenant_id, category_id, name, slug, price) values ($1, $2, $3, $4, $5)",
        [fx.tenantA, catA[0]!.id, "Produto A", `produto-a-${runId}`, 100],
      );
      await client.query(
        "insert into public.store_payment_providers (tenant_id, provider, status) values ($1, 'mercadopago', 'connected')",
        [fx.tenantA],
      );
      await client.query("insert into public.shipping_settings (tenant_id, enabled) values ($1, true)", [fx.tenantA]);
      await client.query(
        "insert into public.shipping_methods (tenant_id, name, price, status) values ($1, $2, $3, 'active')",
        [fx.tenantA, `Frete A ${runId}`, 15],
      );
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  interface TenantRow {
    name: string;
    segment: string | null;
    instagram_handle: string | null;
    whatsapp_phone: string | null;
    contact_email: string | null;
    logo_url: string | null;
  }

  const EMPTY_SIGNALS = {
    storeName: "",
    segment: null,
    instagramHandle: null,
    whatsappPhone: null,
    contactEmail: null,
    logoUrl: null,
    productCount: 0,
    categoryCount: 0,
    paymentConnected: false,
    shippingEnabled: false,
    activeShippingMethodCount: 0,
  } satisfies StoreSetupRawSignals;

  /**
   * Reproduz exatamente as 6 queries de `resolveStoreSetupChecklist`
   * (features/painel/store-setup.ts), rodando como o próprio ator
   * autenticado (RLS real, nunca superuser/service_role) — mesma garantia
   * de isolamento que a função de produção depende para nunca vazar dado
   * entre tenants.
   */
  async function collectRawSignals(tenantId: string, actorUserId: string): Promise<StoreSetupRawSignals> {
    return asActor({ role: "authenticated", userId: actorUserId }, async (c) => {
      // Queries sequenciais na mesma conexão/transação, nunca em
      // Promise.all sobre o mesmo PoolClient — `pg` não suporta pipelining
      // concorrente numa única conexão (mesma razão de resolveStoreSetupChecklist
      // usar Promise.all com 6 clients HTTP/PostgREST independentes, nunca
      // uma única conexão de banco literal).
      const tenantRes = await c.query<TenantRow>(
        "select name, segment, instagram_handle, whatsapp_phone, contact_email, logo_url from public.tenants where id = $1",
        [tenantId],
      );
      const productRes = await c.query("select id from public.products where tenant_id = $1", [tenantId]);
      const categoryRes = await c.query("select id from public.categories where tenant_id = $1", [tenantId]);
      const paymentRes = await c.query<{ status: string }>(
        "select status from public.store_payment_providers where tenant_id = $1 and provider = 'mercadopago'",
        [tenantId],
      );
      const shippingSettingsRes = await c.query<{ enabled: boolean }>(
        "select enabled from public.shipping_settings where tenant_id = $1",
        [tenantId],
      );
      const shippingMethodRes = await c.query(
        "select id from public.shipping_methods where tenant_id = $1 and status = 'active'",
        [tenantId],
      );

      const tenantRow = tenantRes.rows[0];
      return {
        storeName: tenantRow?.name ?? "",
        segment: tenantRow?.segment ?? null,
        instagramHandle: tenantRow?.instagram_handle ?? null,
        whatsappPhone: tenantRow?.whatsapp_phone ?? null,
        contactEmail: tenantRow?.contact_email ?? null,
        logoUrl: tenantRow?.logo_url ?? null,
        productCount: productRes.rowCount ?? 0,
        categoryCount: categoryRes.rowCount ?? 0,
        paymentConnected: paymentRes.rows[0]?.status === "connected",
        shippingEnabled: shippingSettingsRes.rows[0]?.enabled ?? false,
        activeShippingMethodCount: shippingMethodRes.rowCount ?? 0,
      };
    });
  }

  it("Tenant A (totalmente configurado) recebe somente os próprios sinais — checklist 100% completo", async () => {
    const raw = await collectRawSignals(fx.tenantA, fx.userAOwner);
    expect(raw).toMatchObject({
      productCount: 1,
      categoryCount: 1,
      paymentConnected: true,
      shippingEnabled: true,
      activeShippingMethodCount: 1,
      logoUrl: `${fx.tenantA}/logo/logo.png`,
    });

    const checklist = buildStoreSetupChecklist(raw, "ecommerce");
    expect(checklist.allComplete).toBe(true);
    expect(checklist.completedCount).toBe(checklist.totalCount);
    expect(checklist.percentage).toBe(100);
  });

  it("Tenant B (sem nenhuma configuração) recebe somente os próprios sinais — nunca herda o que o Tenant A configurou", async () => {
    const raw = await collectRawSignals(fx.tenantB, fx.userBOwner);
    expect(raw).toMatchObject({
      productCount: 0,
      categoryCount: 0,
      paymentConnected: false,
      shippingEnabled: false,
      activeShippingMethodCount: 0,
      logoUrl: null,
    });
    // storeName vem do próprio nome do tenant B (não vazio) — só as
    // condições que dependem de dado nunca preenchido para B (segmento/
    // Instagram/WhatsApp/e-mail/logo/produtos/categorias/pagamento/
    // entrega) precisam ser "ausentes".
    expect(raw.segment).toBeNull();
    expect(raw.instagramHandle).toBeNull();

    const checklist = buildStoreSetupChecklist(raw, "ecommerce");
    expect(checklist.allComplete).toBe(false);
    expect(checklist.completedCount).toBe(0);
    expect(checklist.percentage).toBe(0);
  });

  it("RLS bloqueia: owner do Tenant A não enxerga NENHUM sinal do Tenant B, mesmo consultando o id de B diretamente", async () => {
    const raw = await collectRawSignals(fx.tenantB, fx.userAOwner);
    expect(raw).toEqual(EMPTY_SIGNALS);
  });

  it("RLS bloqueia: owner do Tenant B não enxerga NENHUM sinal do Tenant A, mesmo consultando o id de A diretamente", async () => {
    const raw = await collectRawSignals(fx.tenantA, fx.userBOwner);
    expect(raw).toEqual(EMPTY_SIGNALS);

    // Mesmo sem enxergar nada de A (que está 100% configurado), o
    // resultado ainda produz um checklist coerente e vazio — nunca lança
    // exceção, nunca "vaza" o estado real de A por acidente.
    const checklist = buildStoreSetupChecklist(raw, "ecommerce");
    expect(checklist.completedCount).toBe(0);
  });

  it("outsider (sem membership em A nem em B) não enxerga sinal nenhum de nenhum dos dois tenants", async () => {
    const rawA = await collectRawSignals(fx.tenantA, fx.userOutsider);
    const rawB = await collectRawSignals(fx.tenantB, fx.userOutsider);
    expect(rawA).toEqual(EMPTY_SIGNALS);
    expect(rawB).toEqual(EMPTY_SIGNALS);
  });
});
