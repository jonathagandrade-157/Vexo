/**
 * D18.5.1 — fecha os gaps de auditoria restantes: aparência da loja
 * (logo/cores/modelo), checkout_mode, endereço da loja (address_*) em
 * `tenants`, e todo o CRUD de `storefront_banners` — nenhum dos 4 tinha
 * evento em `audit_logs` antes desta migration (20260817220108). Mesmo
 * padrão de `tests/integration/audit-pix-and-domain-changes.test.ts`
 * (auditoria testada direto via SQL/asActor, nunca através do runtime do
 * Next.js).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

interface AuditLogRow {
  id: string;
  tenant_id: string | null;
  actor_user_id: string | null;
  actor_type: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Auditoria D18.5.1 — gaps restantes", () => {
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await buildFixtures();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function logsFor(tenantId: string, resourceType: string): Promise<AuditLogRow[]> {
    const { rows } = await withSuperuser((c) =>
      c.query<AuditLogRow>(
        "select * from public.audit_logs where tenant_id = $1 and resource_type = $2 order by created_at",
        [tenantId, resourceType],
      ),
    );
    return rows;
  }

  describe("Aparência da loja (TENANT_APPEARANCE_UPDATED)", () => {
    it("alterar primary_color/secondary_color/storefront_template juntos gera um único TENANT_APPEARANCE_UPDATED", async () => {
      await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) =>
          c.query(
            "update public.tenants set primary_color = '#112233', secondary_color = '#445566', storefront_template = 'minimal' where id = $1",
            [fx.tenantA],
          ),
        { commit: true },
      );
      const logs = await logsFor(fx.tenantA, "tenant");
      const evt = logs.filter((l) => l.action === "TENANT_APPEARANCE_UPDATED").pop();
      expect(evt).toBeDefined();
      expect(evt!.after).toMatchObject({
        primary_color: "#112233",
        secondary_color: "#445566",
        storefront_template: "minimal",
      });
    });

    it("alterar somente logo_url (fluxo separado de upload/remoção de logo) também gera TENANT_APPEARANCE_UPDATED", async () => {
      await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("update public.tenants set logo_url = $1 where id = $2", ["11111111-1111-1111-1111-111111111111/logo.png", fx.tenantA]),
        { commit: true },
      );
      const logs = await logsFor(fx.tenantA, "tenant");
      const evt = logs.filter((l) => l.action === "TENANT_APPEARANCE_UPDATED").pop();
      expect(evt).toBeDefined();
      expect((evt!.after as { logo_url: string }).logo_url).toContain("logo.png");
    });

    it("logo_url gravado é sempre um path curto, nunca binário — nenhum payload gigante no histórico", async () => {
      const logs = await logsFor(fx.tenantA, "tenant");
      const evt = logs.filter((l) => l.action === "TENANT_APPEARANCE_UPDATED").pop();
      const serialized = JSON.stringify(evt);
      expect(serialized.length).toBeLessThan(2000);
    });

    it("UPDATE que não muda nenhum campo de aparência não gera TENANT_APPEARANCE_UPDATED novo", async () => {
      const before = (await logsFor(fx.tenantA, "tenant")).filter((l) => l.action === "TENANT_APPEARANCE_UPDATED").length;
      await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("update public.tenants set name = name where id = $1", [fx.tenantA]),
        { commit: true },
      );
      const after = (await logsFor(fx.tenantA, "tenant")).filter((l) => l.action === "TENANT_APPEARANCE_UPDATED").length;
      expect(after).toBe(before);
    });

    it("isolamento: aparência alterada no tenant A não gera evento para o tenant B", async () => {
      const logsB = await logsFor(fx.tenantB, "tenant");
      expect(logsB.filter((l) => l.action === "TENANT_APPEARANCE_UPDATED")).toHaveLength(0);
    });
  });

  describe("checkout_mode (TENANT_CHECKOUT_MODE_UPDATED)", () => {
    it("alterar checkout_mode gera TENANT_CHECKOUT_MODE_UPDATED com before/after mínimos", async () => {
      await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("update public.tenants set checkout_mode = 'whatsapp' where id = $1", [fx.tenantA]),
        { commit: true },
      );
      const logs = await logsFor(fx.tenantA, "tenant");
      const evt = logs.filter((l) => l.action === "TENANT_CHECKOUT_MODE_UPDATED").pop();
      expect(evt).toBeDefined();
      expect(evt!.before).toMatchObject({ checkout_mode: "vexo" });
      expect(evt!.after).toMatchObject({ checkout_mode: "whatsapp" });
      // nunca o tenant inteiro — só o campo relevante.
      expect(Object.keys(evt!.after!)).toEqual(["checkout_mode"]);

      await withSuperuser((c) => c.query("update public.tenants set checkout_mode = 'vexo' where id = $1", [fx.tenantA]));
    });

    it("UPDATE que não muda checkout_mode não gera evento novo", async () => {
      const before = (await logsFor(fx.tenantA, "tenant")).filter((l) => l.action === "TENANT_CHECKOUT_MODE_UPDATED").length;
      await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("update public.tenants set checkout_mode = checkout_mode where id = $1", [fx.tenantA]),
        { commit: true },
      );
      const after = (await logsFor(fx.tenantA, "tenant")).filter((l) => l.action === "TENANT_CHECKOUT_MODE_UPDATED").length;
      expect(after).toBe(before);
    });

    it("isolamento: mudança no tenant A não aparece para o tenant B", async () => {
      const logsB = await logsFor(fx.tenantB, "tenant");
      expect(logsB.filter((l) => l.action === "TENANT_CHECKOUT_MODE_UPDATED")).toHaveLength(0);
    });
  });

  describe("Endereço da loja (TENANT_ADDRESS_UPDATED)", () => {
    it("alterar os 7 campos de endereço gera TENANT_ADDRESS_UPDATED", async () => {
      await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) =>
          c.query(
            `update public.tenants set
               address_zip = '01310100', address_street = 'Av. Paulista', address_number = '1000',
               address_complement = 'Sala 1', address_neighborhood = 'Bela Vista',
               address_city = 'São Paulo', address_state = 'SP'
             where id = $1`,
            [fx.tenantA],
          ),
        { commit: true },
      );
      const logs = await logsFor(fx.tenantA, "tenant");
      const evt = logs.filter((l) => l.action === "TENANT_ADDRESS_UPDATED").pop();
      expect(evt).toBeDefined();
      expect(evt!.after).toMatchObject({ address_city: "São Paulo", address_state: "SP", address_zip: "01310100" });
    });

    it("nenhum dado sensível (token/secret/senha) pode aparecer — o evento só contém os 7 campos de endereço", async () => {
      const logs = await logsFor(fx.tenantA, "tenant");
      const evt = logs.filter((l) => l.action === "TENANT_ADDRESS_UPDATED").pop();
      const keys = Object.keys(evt!.after!).sort();
      expect(keys).toEqual(
        ["address_city", "address_complement", "address_neighborhood", "address_number", "address_state", "address_street", "address_zip"].sort(),
      );
    });

    it("UPDATE que não muda nenhum campo de endereço não gera evento novo", async () => {
      const before = (await logsFor(fx.tenantA, "tenant")).filter((l) => l.action === "TENANT_ADDRESS_UPDATED").length;
      await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("update public.tenants set address_city = address_city where id = $1", [fx.tenantA]),
        { commit: true },
      );
      const after = (await logsFor(fx.tenantA, "tenant")).filter((l) => l.action === "TENANT_ADDRESS_UPDATED").length;
      expect(after).toBe(before);
    });

    it("isolamento: endereço alterado no tenant A não gera evento para o tenant B", async () => {
      const logsB = await logsFor(fx.tenantB, "tenant");
      expect(logsB.filter((l) => l.action === "TENANT_ADDRESS_UPDATED")).toHaveLength(0);
    });
  });

  describe("storefront_banners (STOREFRONT_BANNER_CREATED/UPDATED/DELETED)", () => {
    it("INSERT gera STOREFRONT_BANNER_CREATED com before nulo", async () => {
      const inserted = await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) =>
          c.query<{ id: string }>(
            "insert into public.storefront_banners (tenant_id, image_path, title, link_url, status, sort_order) values ($1, $2, $3, $4, 'active', 0) returning id",
            [fx.tenantA, `${fx.tenantA}/banners/b1.jpg`, "Promoção", "https://example.com/promo"],
          ),
        { commit: true },
      );
      const bannerId = inserted.rows[0]!.id;

      const logs = await logsFor(fx.tenantA, "storefront_banner");
      const evt = logs.find((l) => l.action === "STOREFRONT_BANNER_CREATED" && l.resource_id === bannerId);
      expect(evt).toBeDefined();
      expect(evt!.before).toBeNull();
      expect(evt!.after).toMatchObject({ title: "Promoção", status: "active", sort_order: 0 });

      // Limpeza via asActor (não withSuperuser): banners de verdade são
      // sempre excluídos pela sessão autenticada (banner-actions.ts nunca
      // usa service_role) — usar o mesmo caminho aqui evita poluir os
      // eventos deste describe com um actor_type='system' artificial que
      // não reflete nenhuma Server Action real.
      await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("delete from public.storefront_banners where id = $1", [bannerId]),
        { commit: true },
      );
    });

    it("UPDATE (título/link/status) gera STOREFRONT_BANNER_UPDATED com before/after corretos", async () => {
      const inserted = await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) =>
          c.query<{ id: string }>(
            "insert into public.storefront_banners (tenant_id, image_path, title, status, sort_order) values ($1, $2, 'Original', 'active', 0) returning id",
            [fx.tenantA, `${fx.tenantA}/banners/b2.jpg`],
          ),
        { commit: true },
      );
      const bannerId = inserted.rows[0]!.id;

      await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("update public.storefront_banners set title = 'Atualizado', status = 'inactive' where id = $1", [bannerId]),
        { commit: true },
      );

      const logs = await logsFor(fx.tenantA, "storefront_banner");
      const evt = logs.find((l) => l.action === "STOREFRONT_BANNER_UPDATED" && l.resource_id === bannerId);
      expect(evt).toBeDefined();
      expect((evt!.before as { title: string }).title).toBe("Original");
      expect(evt!.after).toMatchObject({ title: "Atualizado", status: "inactive" });

      await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("delete from public.storefront_banners where id = $1", [bannerId]),
        { commit: true },
      );
    });

    it("DELETE gera STOREFRONT_BANNER_DELETED com after nulo", async () => {
      const inserted = await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) =>
          c.query<{ id: string }>(
            "insert into public.storefront_banners (tenant_id, image_path, title, status, sort_order) values ($1, $2, 'Para Excluir', 'active', 0) returning id",
            [fx.tenantA, `${fx.tenantA}/banners/b3.jpg`],
          ),
        { commit: true },
      );
      const bannerId = inserted.rows[0]!.id;

      await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("delete from public.storefront_banners where id = $1", [bannerId]),
        { commit: true },
      );

      const logs = await logsFor(fx.tenantA, "storefront_banner");
      const evt = logs.find((l) => l.action === "STOREFRONT_BANNER_DELETED" && l.resource_id === bannerId);
      expect(evt).toBeDefined();
      expect(evt!.after).toBeNull();
      expect(evt!.before).toMatchObject({ title: "Para Excluir" });
    });

    it("image_path gravado é sempre um path curto, nunca a imagem binária", async () => {
      const logs = await logsFor(fx.tenantA, "storefront_banner");
      for (const l of logs) {
        const serialized = JSON.stringify(l);
        expect(serialized.length).toBeLessThan(2000);
      }
    });

    it("tenant_id e actor corretos em todos os eventos de banner", async () => {
      const logs = await logsFor(fx.tenantA, "storefront_banner");
      expect(logs.length).toBeGreaterThan(0);
      for (const l of logs) {
        expect(l.tenant_id).toBe(fx.tenantA);
        expect(l.actor_user_id).toBe(fx.userAOwner);
        expect(l.actor_type).toBe("user");
      }
    });

    it("isolamento: banner criado no tenant A não gera evento para o tenant B, e input não pode direcionar o evento para outro tenant", async () => {
      const logsB = await logsFor(fx.tenantB, "storefront_banner");
      expect(logsB).toHaveLength(0);

      // Um membro do tenant A não consegue inserir um banner (nem, por
      // extensão, gerar um evento de auditoria) para o tenant B — RLS de
      // storefront_banners (has_permission(tenant_id, 'settings.update'))
      // já bloqueia antes mesmo do trigger de auditoria rodar.
      await expect(
        asActor(
          { role: "authenticated", userId: fx.userAOwner },
          (c) =>
            c.query(
              "insert into public.storefront_banners (tenant_id, image_path, title, status, sort_order) values ($1, $2, 'Forjado', 'active', 0)",
              [fx.tenantB, `${fx.tenantB}/banners/forged.jpg`],
            ),
          { commit: true },
        ),
      ).rejects.toThrow();
    });
  });

  describe("audit_logs permanece append-only e RLS inalterada", () => {
    it("nenhuma policy de INSERT/UPDATE/DELETE foi adicionada a audit_logs", async () => {
      const result = await withSuperuser((c) =>
        c.query<{ cmd: string }>("select cmd from pg_policies where schemaname = 'public' and tablename = 'audit_logs'"),
      );
      expect(result.rows.map((r) => r.cmd)).toEqual(["SELECT"]);
    });

    it("o índice de D18.4 (audit_logs_tenant_id_created_at_idx) não foi alterado por esta migration", async () => {
      const result = await withSuperuser((c) =>
        c.query<{ indexdef: string }>(
          "select indexdef from pg_indexes where schemaname = 'public' and tablename = 'audit_logs' and indexname = 'audit_logs_tenant_id_created_at_idx'",
        ),
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.indexdef.toLowerCase()).toContain("btree (tenant_id, created_at desc)");
    });
  });
});
