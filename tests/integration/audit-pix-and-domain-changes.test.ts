/**
 * D18.1 — fecha os dois gaps de auditoria ALTO da auditoria D18.0 (§H):
 * mudanças de PIX em `tenants` e todo o CRUD de `tenant_domains` passam a
 * gerar `audit_logs` via trigger + `private.log_audit()` (migration
 * 20260817220103) — nenhuma chamada manual nas Server Actions, mesmo
 * padrão de `tests/integration/shipping.test.ts` (auditoria testada
 * direto via SQL/asActor, nunca através do runtime do Next.js).
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

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Auditoria D18.1 — PIX e tenant_domains", () => {
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

  describe("PIX em tenants (TENANT_PIX_SETTINGS_UPDATED)", () => {
    it("alterar pix_key sozinho gera TENANT_PIX_SETTINGS_UPDATED", async () => {
      await withSuperuser((c) =>
        c.query(
          "update public.tenants set pix_key = 'seed@example.com', pix_key_type = 'email', pix_recipient_name = 'Loja Seed' where id = $1",
          [fx.tenantA],
        ),
      );
      await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("update public.tenants set pix_key = 'nova-chave@example.com' where id = $1", [fx.tenantA]),
        { commit: true },
      );
      const logs = await logsFor(fx.tenantA, "tenant");
      const evt = logs.find((l) => l.action === "TENANT_PIX_SETTINGS_UPDATED");
      expect(evt).toBeDefined();
    });

    it("alterar pix_key_type sozinho gera TENANT_PIX_SETTINGS_UPDATED", async () => {
      await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("update public.tenants set pix_key_type = 'random' where id = $1", [fx.tenantA]),
        { commit: true },
      );
      const logs = await logsFor(fx.tenantA, "tenant");
      const evt = logs.filter((l) => l.action === "TENANT_PIX_SETTINGS_UPDATED").pop();
      expect(evt).toBeDefined();
      expect(evt!.after).toMatchObject({ pix_key_type: "random" });
    });

    it("alterar pix_recipient_name sozinho gera TENANT_PIX_SETTINGS_UPDATED", async () => {
      await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("update public.tenants set pix_recipient_name = 'Novo Nome' where id = $1", [fx.tenantA]),
        { commit: true },
      );
      const logs = await logsFor(fx.tenantA, "tenant");
      const evt = logs.filter((l) => l.action === "TENANT_PIX_SETTINGS_UPDATED").pop();
      expect(evt).toBeDefined();
      expect(evt!.after).toMatchObject({ pix_recipient_name: "Novo Nome" });
    });

    it("alterar pix_enabled sozinho (com pré-requisitos já preenchidos) gera TENANT_PIX_SETTINGS_UPDATED", async () => {
      await withSuperuser((c) =>
        c.query("update public.tenants set address_city = 'São Paulo' where id = $1", [fx.tenantA]),
      );
      await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("update public.tenants set pix_enabled = true where id = $1", [fx.tenantA]),
        { commit: true },
      );
      const logs = await logsFor(fx.tenantA, "tenant");
      const evt = logs.filter((l) => l.action === "TENANT_PIX_SETTINGS_UPDATED").pop();
      expect(evt).toBeDefined();
      expect(evt!.after).toMatchObject({ pix_enabled: true });

      // limpa para não interferir nos próximos testes deste describe.
      await withSuperuser((c) =>
        c.query(
          "update public.tenants set pix_enabled = false, pix_key = null, pix_key_type = null, pix_recipient_name = null, address_city = null where id = $1",
          [fx.tenantA],
        ),
      );
    });

    it("UPDATE que não muda nenhum campo de PIX não gera TENANT_PIX_SETTINGS_UPDATED novo", async () => {
      const before = (await logsFor(fx.tenantA, "tenant")).filter((l) => l.action === "TENANT_PIX_SETTINGS_UPDATED").length;

      await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("update public.tenants set name = 'Tenant A Renomeado' where id = $1", [fx.tenantA]),
        { commit: true },
      );
      // Reenvio com os MESMOS valores de PIX já vigentes (double submit) — is distinct from não detecta mudança nenhuma.
      const current = await withSuperuser((c) =>
        c.query<{ pix_key: string | null; pix_key_type: string | null; pix_recipient_name: string | null; pix_enabled: boolean }>(
          "select pix_key, pix_key_type, pix_recipient_name, pix_enabled from public.tenants where id = $1",
          [fx.tenantA],
        ),
      );
      const row = current.rows[0]!;
      await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) =>
          c.query(
            "update public.tenants set pix_key = $1, pix_key_type = $2, pix_recipient_name = $3, pix_enabled = $4 where id = $5",
            [row.pix_key, row.pix_key_type, row.pix_recipient_name, row.pix_enabled, fx.tenantA],
          ),
        { commit: true },
      );

      const after = (await logsFor(fx.tenantA, "tenant")).filter((l) => l.action === "TENANT_PIX_SETTINGS_UPDATED").length;
      expect(after).toBe(before);
    });

    it("valor bruto de pix_key nunca aparece em audit_logs — só mascarado (mesmo padrão de mask_account_id)", async () => {
      const rawKey = "12345678901";
      await asActor(
        { role: "authenticated", userId: fx.userAOwner },
        (c) => c.query("update public.tenants set pix_key = $1, pix_key_type = 'cpf_cnpj' where id = $2", [rawKey, fx.tenantA]),
        { commit: true },
      );
      const logs = await logsFor(fx.tenantA, "tenant");
      const evt = logs.filter((l) => l.action === "TENANT_PIX_SETTINGS_UPDATED").pop();
      expect(evt).toBeDefined();
      const serialized = JSON.stringify(evt!.after);
      expect(serialized).not.toContain(rawKey);
      // mask_account_id mantém só os últimos 4 caracteres visíveis.
      expect((evt!.after as { pix_key: string }).pix_key).toBe("*******8901");
    });

    it("tenant_id correto é preservado no evento de PIX", async () => {
      const logs = await logsFor(fx.tenantA, "tenant");
      const evt = logs.filter((l) => l.action === "TENANT_PIX_SETTINGS_UPDATED").pop();
      expect(evt!.tenant_id).toBe(fx.tenantA);
    });

    it("actor correto (usuário real) é preservado quando a operação é feita por um OWNER autenticado", async () => {
      const logs = await logsFor(fx.tenantA, "tenant");
      const evt = logs.filter((l) => l.action === "TENANT_PIX_SETTINGS_UPDATED").pop();
      expect(evt!.actor_user_id).toBe(fx.userAOwner);
      expect(evt!.actor_type).toBe("user");
    });

    it("isolamento: mudança de PIX no tenant A não gera nenhum evento associado ao tenant B", async () => {
      const logsB = await logsFor(fx.tenantB, "tenant");
      const pixEventsB = logsB.filter((l) => l.action === "TENANT_PIX_SETTINGS_UPDATED");
      expect(pixEventsB).toHaveLength(0);
    });
  });

  describe("tenant_domains (TENANT_DOMAIN_CREATED/UPDATED/DELETED)", () => {
    it("INSERT gera TENANT_DOMAIN_CREATED", async () => {
      const domain = `d18-1-created-${fx.tenantA}.example.com`;
      await asActor(
        { role: "service_role" },
        (c) =>
          c.query(
            "insert into public.tenant_domains (tenant_id, domain, domain_type, status) values ($1, $2, 'custom', 'pending')",
            [fx.tenantA, domain],
          ),
        { commit: true },
      );
      const logs = await logsFor(fx.tenantA, "tenant_domain");
      const evt = logs.find((l) => l.action === "TENANT_DOMAIN_CREATED" && (l.after as { domain: string })?.domain === domain);
      expect(evt).toBeDefined();
      expect(evt!.before).toBeNull();
      expect(evt!.after).toMatchObject({ domain, domain_type: "custom", status: "pending" });

      await withSuperuser((c) => c.query("delete from public.tenant_domains where domain = $1", [domain]));
    });

    it("UPDATE relevante (status/verificação) gera TENANT_DOMAIN_UPDATED", async () => {
      const domain = `d18-1-updated-${fx.tenantA}.example.com`;
      const inserted = await asActor(
        { role: "service_role" },
        (c) =>
          c.query<{ id: string }>(
            "insert into public.tenant_domains (tenant_id, domain, domain_type, status) values ($1, $2, 'custom', 'pending') returning id",
            [fx.tenantA, domain],
          ),
        { commit: true },
      );
      const domainId = inserted.rows[0]!.id;

      await asActor(
        { role: "service_role" },
        (c) =>
          c.query(
            `update public.tenant_domains
             set status = 'verifying', verification_method = 'dns_txt',
                 verification_token_hash = $1, verification_started_at = now(), verification_expires_at = now() + interval '72 hours'
             where id = $2`,
            ["a".repeat(64), domainId],
          ),
        { commit: true },
      );

      const logs = await logsFor(fx.tenantA, "tenant_domain");
      const evt = logs.find((l) => l.action === "TENANT_DOMAIN_UPDATED" && l.resource_id === domainId);
      expect(evt).toBeDefined();
      expect(evt!.after).toMatchObject({ status: "verifying", verification_method: "dns_txt", verification_token_present: true });
      expect((evt!.before as { status: string }).status).toBe("pending");

      await withSuperuser((c) => c.query("delete from public.tenant_domains where id = $1", [domainId]));
    });

    it("verification_token_hash nunca aparece em texto (só o booleano verification_token_present)", async () => {
      const logs = await logsFor(fx.tenantA, "tenant_domain");
      const evt = logs.filter((l) => l.action === "TENANT_DOMAIN_UPDATED").pop();
      expect(evt).toBeDefined();
      const serialized = JSON.stringify(evt);
      expect(serialized).not.toContain("a".repeat(64));
      expect(serialized).toContain("verification_token_present");
    });

    it("UPDATE de campos do binding Vercel também gera TENANT_DOMAIN_UPDATED", async () => {
      const domain = `d18-1-vercel-${fx.tenantA}.example.com`;
      const inserted = await asActor(
        { role: "service_role" },
        (c) =>
          c.query<{ id: string }>(
            "insert into public.tenant_domains (tenant_id, domain, domain_type, status) values ($1, $2, 'custom', 'active') returning id",
            [fx.tenantA, domain],
          ),
        { commit: true },
      );
      const domainId = inserted.rows[0]!.id;

      await asActor(
        { role: "service_role" },
        (c) =>
          c.query(
            "update public.tenant_domains set vercel_domain_status = 'registered', vercel_registered_at = now(), vercel_last_checked_at = now() where id = $1",
            [domainId],
          ),
        { commit: true },
      );

      const logs = await logsFor(fx.tenantA, "tenant_domain");
      const evt = logs.find(
        (l) => l.action === "TENANT_DOMAIN_UPDATED" && l.resource_id === domainId && (l.after as { vercel_domain_status: string })?.vercel_domain_status === "registered",
      );
      expect(evt).toBeDefined();

      // Limpa o domínio 'active' criado por este teste — audit_logs (independente,
      // sem FK para tenant_domains) preserva os eventos já asserted acima mesmo após o DELETE.
      await withSuperuser((c) => c.query("delete from public.tenant_domains where id = $1", [domainId]));
    });

    it("UPDATE que não muda nenhum dos campos cobertos não gera TENANT_DOMAIN_UPDATED novo", async () => {
      const domain = `d18-1-noop-${fx.tenantA}.example.com`;
      const inserted = await asActor(
        { role: "service_role" },
        (c) =>
          c.query<{ id: string }>(
            "insert into public.tenant_domains (tenant_id, domain, domain_type, status) values ($1, $2, 'custom', 'pending') returning id",
            [fx.tenantA, domain],
          ),
        { commit: true },
      );
      const domainId = inserted.rows[0]!.id;

      const before = (await logsFor(fx.tenantA, "tenant_domain")).filter(
        (l) => l.action === "TENANT_DOMAIN_UPDATED" && l.resource_id === domainId,
      ).length;

      // UPDATE que reafirma exatamente o mesmo valor de domain/status já vigente.
      await asActor(
        { role: "service_role" },
        (c) => c.query("update public.tenant_domains set domain = domain where id = $1", [domainId]),
        { commit: true },
      );

      const after = (await logsFor(fx.tenantA, "tenant_domain")).filter(
        (l) => l.action === "TENANT_DOMAIN_UPDATED" && l.resource_id === domainId,
      ).length;
      expect(after).toBe(before);

      await withSuperuser((c) => c.query("delete from public.tenant_domains where id = $1", [domainId]));
    });

    it("DELETE gera TENANT_DOMAIN_DELETED", async () => {
      const domain = `d18-1-deleted-${fx.tenantA}.example.com`;
      const inserted = await asActor(
        { role: "service_role" },
        (c) =>
          c.query<{ id: string }>(
            "insert into public.tenant_domains (tenant_id, domain, domain_type, status) values ($1, $2, 'custom', 'pending') returning id",
            [fx.tenantA, domain],
          ),
        { commit: true },
      );
      const domainId = inserted.rows[0]!.id;

      await asActor(
        { role: "service_role" },
        (c) => c.query("delete from public.tenant_domains where id = $1", [domainId]),
        { commit: true },
      );

      const logs = await logsFor(fx.tenantA, "tenant_domain");
      const evt = logs.find((l) => l.action === "TENANT_DOMAIN_DELETED" && l.resource_id === domainId);
      expect(evt).toBeDefined();
      expect(evt!.after).toBeNull();
      expect(evt!.before).toMatchObject({ domain, domain_type: "custom" });
    });

    it("tenant_id correto é preservado em todos os eventos de tenant_domain", async () => {
      const logs = await logsFor(fx.tenantA, "tenant_domain");
      expect(logs.length).toBeGreaterThan(0);
      for (const l of logs) expect(l.tenant_id).toBe(fx.tenantA);
    });

    it("actor: mutações de tenant_domains hoje sempre passam por service_role (D17.1/D17.5.1) — actor_type registrado como 'system', nunca forjado como um usuário específico", async () => {
      const logs = await logsFor(fx.tenantA, "tenant_domain");
      expect(logs.length).toBeGreaterThan(0);
      for (const l of logs) {
        expect(l.actor_type).toBe("system");
        expect(l.actor_user_id).toBeNull();
      }
    });

    it("isolamento: eventos de tenant_domains do tenant A não aparecem para o tenant B", async () => {
      const domain = `d18-1-isolamento-b-${fx.tenantB}.example.com`;
      await asActor(
        { role: "service_role" },
        (c) =>
          c.query(
            "insert into public.tenant_domains (tenant_id, domain, domain_type, status) values ($1, $2, 'custom', 'pending')",
            [fx.tenantB, domain],
          ),
        { commit: true },
      );

      const logsA = await logsFor(fx.tenantA, "tenant_domain");
      const logsB = await logsFor(fx.tenantB, "tenant_domain");

      expect(logsA.every((l) => l.tenant_id === fx.tenantA)).toBe(true);
      expect(logsB.every((l) => l.tenant_id === fx.tenantB)).toBe(true);
      expect(logsB.some((l) => (l.after as { domain?: string } | null)?.domain === domain)).toBe(true);

      await withSuperuser((c) => c.query("delete from public.tenant_domains where domain = $1", [domain]));
    });
  });
});
