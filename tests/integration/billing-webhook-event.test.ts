/**
 * Etapa 20.2.7.1 — `apply_billing_webhook_event` (migration
 * 20260817220074). Mesmo padrão de toda a suíte: a RPC é testada
 * diretamente via SQL (asActor/withSuperuser), nunca através de um Route
 * Handler (que não existe ainda — fora do escopo desta etapa).
 *
 * Escopo coberto: idempotência (nunca duplica efeito numa reaplicação),
 * ordem (só last_gateway_event_at decide, nunca updated_at), o desenho
 * exato de cada evento (PAYMENT_CONFIRMED é o único gatilho de ativação e
 * de conversão de trial; PAYMENT_OVERDUE só PENDING→FAILED; PAYMENT_REFUNDED
 * só PAID→REFUNDED; PAYMENT_RECEIVED nunca ativa; PAYMENT_CREATED é
 * sempre noop_already_pending no fluxo de 1ª cobrança; SUBSCRIPTION_*
 * nunca altera subscriptions nesta etapa), a exigência de match exato de
 * (gateway, gateway_invoice_id) sem nenhuma aproximação, e os grants
 * (só service_role tem EXECUTE).
 */
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, expectPgError, pool, withSuperuser } from "./helpers/db";
import { buildFixtures, type Fixtures } from "./helpers/fixtures";

const runId = randomUUID().slice(0, 8);

interface InvoiceRow {
  id: string;
  status: string;
  paid_at: Date | null;
  failed_at: Date | null;
  failure_reason: string | null;
  confirmed_by_event_id: string | null;
  last_gateway_event_at: Date | null;
}

interface SubscriptionRow {
  id: string;
  status: string;
  current_period_start: Date | null;
  current_period_end: Date | null;
}

// `pg` decodifica colunas timestamptz como `Date`, não como a string ISO
// original — comparar por epoch (millis) evita falso-negativo de
// `toBe(isoString)` por causa de tipo, não de valor.
function toMillis(value: Date | string | null): number | null {
  if (value === null) return null;
  return new Date(value).getTime();
}

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Billing — apply_billing_webhook_event (Etapa 20.2.7.1)", () => {
  let fx: Fixtures;
  let basicPlanId: string;

  interface Scenario {
    tenantId: string;
    subscriptionId: string;
    invoiceId: string;
    gatewayInvoiceId: string;
    gatewaySubscriptionId: string;
    periodStart: string;
    periodEnd: string;
  }

  async function insertWebhookEvent(client: PoolClient, tag: string, eventType: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `insert into public.billing_webhook_events (provider, event_id, event_type, payload)
       values ('asaas', $1, $2, '{}'::jsonb) returning id`,
      [`evt_${tag}`, eventType],
    );
    return rows[0]!.id;
  }

  async function createScenario(
    label: string,
    opts: {
      invoiceStatus?: string;
      subscriptionStatus?: string;
      lastGatewayEventAt?: string | null;
      withActiveTrial?: boolean;
      noGatewayOnSubscription?: boolean;
    } = {},
  ): Promise<Scenario> {
    const tag = `${label}-${runId}`;
    return withSuperuser(async (client) => {
      const { rows: userRows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [`${tag}@fixtures.test`],
      );
      const userId = userRows[0]!.id;

      const { rows: tenantRows } = await client.query<{ id: string }>(
        "insert into public.tenants (name, slug, created_by) values ($1, $2, $3) returning id",
        [`Tenant ${tag}`, `tenant-${tag}`, userId],
      );
      const tenantId = tenantRows[0]!.id;

      await client.query("insert into public.tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)", [
        tenantId,
        userId,
        fx.roleIds.OWNER,
      ]);

      if (opts.withActiveTrial) {
        const startedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
        const endsAt = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString();
        await client.query(
          "insert into public.trial_records (tenant_id, started_at, ends_at, status) values ($1, $2, $3, 'active')",
          [tenantId, startedAt, endsAt],
        );
      }

      // `withActiveTrial` já disparou `link_trial_to_subscription` (migration
      // 20260817220063), que faz `insert ... on conflict (tenant_id) do
      // nothing` em subscriptions (plano BASIC, status trialing) antes desta
      // linha rodar — por isso este INSERT precisa ser um upsert (nunca
      // colide em subscriptions_tenant_id_key).
      const gatewaySubscriptionId = `sub_${tag}`;
      const { rows: subRows } = await client.query<{ id: string }>(
        opts.noGatewayOnSubscription
          ? `insert into public.subscriptions (tenant_id, plan_id, status) values ($1, $2, $3)
             on conflict (tenant_id) do update set status = excluded.status
             returning id`
          : `insert into public.subscriptions (tenant_id, plan_id, status, gateway, gateway_subscription_id)
             values ($1, $2, $3, 'asaas', $4)
             on conflict (tenant_id) do update set
               status = excluded.status, gateway = excluded.gateway, gateway_subscription_id = excluded.gateway_subscription_id
             returning id`,
        opts.noGatewayOnSubscription
          ? [tenantId, basicPlanId, opts.subscriptionStatus ?? "trialing"]
          : [tenantId, basicPlanId, opts.subscriptionStatus ?? "trialing", gatewaySubscriptionId],
      );
      const subscriptionId = subRows[0]!.id;

      const gatewayInvoiceId = `inv_${tag}`;
      const periodStart = new Date().toISOString();
      const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const { rows: invRows } = await client.query<{ id: string }>(
        `insert into public.billing_invoices
           (tenant_id, subscription_id, gateway, gateway_invoice_id, plan_id, plan_name_snapshot,
            amount, billing_cycle, status, period_start, period_end, due_at, last_gateway_event_at)
         values ($1, $2, 'asaas', $3, $4, 'Basic', 49.9, 'monthly', $5, $6, $7, $6, $8)
         returning id`,
        [
          tenantId,
          subscriptionId,
          gatewayInvoiceId,
          basicPlanId,
          opts.invoiceStatus ?? "PENDING",
          periodStart,
          periodEnd,
          opts.lastGatewayEventAt ?? null,
        ],
      );

      return {
        tenantId,
        subscriptionId,
        invoiceId: invRows[0]!.id,
        gatewayInvoiceId,
        gatewaySubscriptionId,
        periodStart,
        periodEnd,
      };
    });
  }

  function applyEvent(
    actor: Parameters<typeof asActor>[0],
    args: {
      gateway?: string;
      eventType: string;
      webhookEventId: string;
      gatewayEventAt: string;
      gatewayInvoiceId?: string | null;
      gatewaySubscriptionId?: string | null;
    },
    commit = true,
  ) {
    return asActor(
      actor,
      (c) =>
        c.query<{ apply_billing_webhook_event: string }>(
          "select apply_billing_webhook_event($1, $2, $3, $4, $5, $6) as apply_billing_webhook_event",
          [
            args.gateway ?? "asaas",
            args.eventType,
            args.webhookEventId,
            args.gatewayEventAt,
            args.gatewayInvoiceId ?? null,
            args.gatewaySubscriptionId ?? null,
          ],
        ),
      { commit },
    );
  }

  async function loadInvoice(id: string): Promise<InvoiceRow> {
    const { rows } = await withSuperuser((c) =>
      c.query<InvoiceRow>(
        "select id, status, paid_at, failed_at, failure_reason, confirmed_by_event_id, last_gateway_event_at from public.billing_invoices where id = $1",
        [id],
      ),
    );
    return rows[0]!;
  }

  async function loadSubscription(id: string): Promise<SubscriptionRow> {
    const { rows } = await withSuperuser((c) =>
      c.query<SubscriptionRow>(
        "select id, status, current_period_start, current_period_end from public.subscriptions where id = $1",
        [id],
      ),
    );
    return rows[0]!;
  }

  async function loadTrialStatus(tenantId: string): Promise<string | null> {
    const { rows } = await withSuperuser((c) =>
      c.query<{ status: string }>("select status from public.trial_records where tenant_id = $1", [tenantId]),
    );
    return rows[0]?.status ?? null;
  }

  beforeAll(async () => {
    fx = await buildFixtures();
    const { rows } = await withSuperuser((c) => c.query<{ id: string }>("select id from public.plans where slug = 'basic'"));
    basicPlanId = rows[0]!.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("1) reaplicação do mesmo evento sobre invoice já PAID não duplica efeito (skipped_stale_event)", async () => {
    const s = await createScenario("dup", { withActiveTrial: true });
    const eventAt = new Date().toISOString();
    const evId = await withSuperuser((c) => insertWebhookEvent(c, "dup", "PAYMENT_CONFIRMED"));

    const first = await applyEvent(
      { role: "service_role" },
      { eventType: "PAYMENT_CONFIRMED", webhookEventId: evId, gatewayEventAt: eventAt, gatewayInvoiceId: s.gatewayInvoiceId, gatewaySubscriptionId: s.gatewaySubscriptionId },
    );
    expect(first.rows[0]!.apply_billing_webhook_event).toBe("payment_confirmed");

    const second = await applyEvent(
      { role: "service_role" },
      { eventType: "PAYMENT_CONFIRMED", webhookEventId: evId, gatewayEventAt: eventAt, gatewayInvoiceId: s.gatewayInvoiceId, gatewaySubscriptionId: s.gatewaySubscriptionId },
    );
    expect(second.rows[0]!.apply_billing_webhook_event).toBe("skipped_stale_event");

    const invoice = await loadInvoice(s.invoiceId);
    expect(invoice.status).toBe("PAID");
  });

  it("2) reprocessamento (retry) de um evento ainda não confirmado como processado é seguro — nunca duplica a ativação", async () => {
    const s = await createScenario("retry", { withActiveTrial: true });
    const evId = await withSuperuser((c) => insertWebhookEvent(c, "retry", "PAYMENT_CONFIRMED"));
    const eventAt = new Date().toISOString();
    const args = { eventType: "PAYMENT_CONFIRMED", webhookEventId: evId, gatewayEventAt: eventAt, gatewayInvoiceId: s.gatewayInvoiceId, gatewaySubscriptionId: s.gatewaySubscriptionId };

    await applyEvent({ role: "service_role" }, args);
    const result = await applyEvent({ role: "service_role" }, args); // simula o Route Handler chamando de novo após uma falha antes de marcar processed_at
    expect(result.rows[0]!.apply_billing_webhook_event).toBe("skipped_stale_event");

    const subscription = await loadSubscription(s.subscriptionId);
    expect(subscription.status).toBe("active");
  });

  it("3) evento com gateway_event_at menor que last_gateway_event_at é descartado (skipped_stale_event)", async () => {
    const anchor = new Date();
    const s = await createScenario("order-older", { lastGatewayEventAt: anchor.toISOString() });
    const olderEventAt = new Date(anchor.getTime() - 60_000).toISOString();
    const evId = await withSuperuser((c) => insertWebhookEvent(c, "order-older", "PAYMENT_OVERDUE"));

    const result = await applyEvent(
      { role: "service_role" },
      { eventType: "PAYMENT_OVERDUE", webhookEventId: evId, gatewayEventAt: olderEventAt, gatewayInvoiceId: s.gatewayInvoiceId },
    );
    expect(result.rows[0]!.apply_billing_webhook_event).toBe("skipped_stale_event");

    const invoice = await loadInvoice(s.invoiceId);
    expect(invoice.status).toBe("PENDING");
    expect(toMillis(invoice.last_gateway_event_at)).toBe(toMillis(anchor.toISOString()));
  });

  it("4) evento com gateway_event_at igual a last_gateway_event_at é descartado (comparação <=)", async () => {
    const anchor = new Date();
    const s = await createScenario("order-equal", { lastGatewayEventAt: anchor.toISOString() });
    const evId = await withSuperuser((c) => insertWebhookEvent(c, "order-equal", "PAYMENT_OVERDUE"));

    const result = await applyEvent(
      { role: "service_role" },
      { eventType: "PAYMENT_OVERDUE", webhookEventId: evId, gatewayEventAt: anchor.toISOString(), gatewayInvoiceId: s.gatewayInvoiceId },
    );
    expect(result.rows[0]!.apply_billing_webhook_event).toBe("skipped_stale_event");

    const invoice = await loadInvoice(s.invoiceId);
    expect(invoice.status).toBe("PENDING");
  });

  it("5) evento mais novo é aplicado e avança last_gateway_event_at", async () => {
    const older = new Date(Date.now() - 60_000);
    const s = await createScenario("order-newer", { lastGatewayEventAt: older.toISOString() });
    const newer = new Date();
    const evId = await withSuperuser((c) => insertWebhookEvent(c, "order-newer", "PAYMENT_OVERDUE"));

    const result = await applyEvent(
      { role: "service_role" },
      { eventType: "PAYMENT_OVERDUE", webhookEventId: evId, gatewayEventAt: newer.toISOString(), gatewayInvoiceId: s.gatewayInvoiceId },
    );
    expect(result.rows[0]!.apply_billing_webhook_event).toBe("payment_marked_failed");

    const invoice = await loadInvoice(s.invoiceId);
    expect(invoice.status).toBe("FAILED");
    expect(toMillis(invoice.last_gateway_event_at)).toBe(toMillis(newer.toISOString()));
  });

  it("6) o trigger prevent_billing_invoice_event_regression continua bloqueando um UPDATE que force last_gateway_event_at para trás", async () => {
    const anchor = new Date();
    const s = await createScenario("regression-guard", { lastGatewayEventAt: anchor.toISOString() });
    const err = await expectPgError(
      withSuperuser((c) =>
        c.query("update public.billing_invoices set last_gateway_event_at = $1 where id = $2", [
          new Date(anchor.getTime() - 1000).toISOString(),
          s.invoiceId,
        ]),
      ),
    );
    expect(err.message).toMatch(/last_gateway_event_at cannot move backwards/i);
  });

  it("7/8) PAYMENT_CONFIRMED sobre invoice PENDING: PAID + paid_at + confirmed_by_event_id, e a subscription é ativada com o período da invoice", async () => {
    const s = await createScenario("confirm-ok", { withActiveTrial: true });
    const evId = await withSuperuser((c) => insertWebhookEvent(c, "confirm-ok", "PAYMENT_CONFIRMED"));
    const eventAt = new Date().toISOString();

    const result = await applyEvent(
      { role: "service_role" },
      { eventType: "PAYMENT_CONFIRMED", webhookEventId: evId, gatewayEventAt: eventAt, gatewayInvoiceId: s.gatewayInvoiceId, gatewaySubscriptionId: s.gatewaySubscriptionId },
    );
    expect(result.rows[0]!.apply_billing_webhook_event).toBe("payment_confirmed");

    const invoice = await loadInvoice(s.invoiceId);
    expect(invoice.status).toBe("PAID");
    expect(toMillis(invoice.paid_at)).toBe(toMillis(eventAt));
    expect(invoice.confirmed_by_event_id).toBe(evId);
    expect(toMillis(invoice.last_gateway_event_at)).toBe(toMillis(eventAt));

    const subscription = await loadSubscription(s.subscriptionId);
    expect(subscription.status).toBe("active");
    expect(toMillis(subscription.current_period_start)).toBe(toMillis(s.periodStart));
    expect(toMillis(subscription.current_period_end)).toBe(toMillis(s.periodEnd));
  });

  it("9) PAYMENT_CONFIRMED sobre invoice já PAID é descartado (skipped_stale_event), nunca reverte um estado terminal", async () => {
    const s = await createScenario("confirm-already-paid", { invoiceStatus: "PAID" });
    const evId = await withSuperuser((c) => insertWebhookEvent(c, "confirm-already-paid", "PAYMENT_CONFIRMED"));

    const result = await applyEvent(
      { role: "service_role" },
      { eventType: "PAYMENT_CONFIRMED", webhookEventId: evId, gatewayEventAt: new Date().toISOString(), gatewayInvoiceId: s.gatewayInvoiceId, gatewaySubscriptionId: s.gatewaySubscriptionId },
    );
    expect(result.rows[0]!.apply_billing_webhook_event).toBe("skipped_stale_event");

    const invoice = await loadInvoice(s.invoiceId);
    expect(invoice.confirmed_by_event_id).toBeNull();
  });

  it("10) PAYMENT_CONFIRMED com gateway_subscription_id que não corresponde à subscription da invoice gera erro de inconsistência (rollback total)", async () => {
    const s = await createScenario("confirm-mismatch", { withActiveTrial: true });
    const other = await createScenario("confirm-mismatch-other");
    const evId = await withSuperuser((c) => insertWebhookEvent(c, "confirm-mismatch", "PAYMENT_CONFIRMED"));

    const err = await expectPgError(
      applyEvent(
        { role: "service_role" },
        { eventType: "PAYMENT_CONFIRMED", webhookEventId: evId, gatewayEventAt: new Date().toISOString(), gatewayInvoiceId: s.gatewayInvoiceId, gatewaySubscriptionId: other.gatewaySubscriptionId },
        false,
      ),
    );
    expect(err.message).toMatch(/subscription\/invoice mismatch/i);

    const invoice = await loadInvoice(s.invoiceId);
    expect(invoice.status).toBe("PENDING"); // rollback total — nenhuma escrita parcial
    const trial = await loadTrialStatus(s.tenantId);
    expect(trial).toBe("active"); // trial não convertido por um evento que falhou
  });

  it("11) PAYMENT_CONFIRMED sem invoice correspondente (gateway_invoice_id desconhecido) gera erro — nunca aproxima por outra invoice", async () => {
    const evId = await withSuperuser((c) => insertWebhookEvent(c, "confirm-no-match", "PAYMENT_CONFIRMED"));
    const err = await expectPgError(
      applyEvent(
        { role: "service_role" },
        { eventType: "PAYMENT_CONFIRMED", webhookEventId: evId, gatewayEventAt: new Date().toISOString(), gatewayInvoiceId: `inv-does-not-exist-${runId}` },
        false,
      ),
    );
    expect(err.message).toMatch(/no billing_invoices row/i);
  });

  it("12) PAYMENT_CONFIRMED sem gateway_invoice_id nenhum gera erro — nunca escolhe 'a PENDING mais recente'", async () => {
    await createScenario("confirm-null-invoice-id"); // garante que existe uma PENDING no banco, para provar que não é escolhida
    const evId = await withSuperuser((c) => insertWebhookEvent(c, "confirm-null-invoice-id-evt", "PAYMENT_CONFIRMED"));
    const err = await expectPgError(
      applyEvent(
        { role: "service_role" },
        { eventType: "PAYMENT_CONFIRMED", webhookEventId: evId, gatewayEventAt: new Date().toISOString(), gatewayInvoiceId: null },
        false,
      ),
    );
    expect(err.message).toMatch(/requires gateway_invoice_id/i);
  });

  it("13) PAYMENT_OVERDUE sobre invoice PENDING transiciona para FAILED", async () => {
    const s = await createScenario("overdue-ok");
    const evId = await withSuperuser((c) => insertWebhookEvent(c, "overdue-ok", "PAYMENT_OVERDUE"));
    const result = await applyEvent(
      { role: "service_role" },
      { eventType: "PAYMENT_OVERDUE", webhookEventId: evId, gatewayEventAt: new Date().toISOString(), gatewayInvoiceId: s.gatewayInvoiceId },
    );
    expect(result.rows[0]!.apply_billing_webhook_event).toBe("payment_marked_failed");
    const invoice = await loadInvoice(s.invoiceId);
    expect(invoice.status).toBe("FAILED");
    expect(invoice.failed_at).not.toBeNull();
  });

  it("14) PAYMENT_OVERDUE nunca reverte uma invoice já PAID", async () => {
    const s = await createScenario("overdue-on-paid", { invoiceStatus: "PAID" });
    const evId = await withSuperuser((c) => insertWebhookEvent(c, "overdue-on-paid", "PAYMENT_OVERDUE"));
    const result = await applyEvent(
      { role: "service_role" },
      { eventType: "PAYMENT_OVERDUE", webhookEventId: evId, gatewayEventAt: new Date().toISOString(), gatewayInvoiceId: s.gatewayInvoiceId },
    );
    expect(result.rows[0]!.apply_billing_webhook_event).toBe("skipped_stale_event");
    const invoice = await loadInvoice(s.invoiceId);
    expect(invoice.status).toBe("PAID");
  });

  it("15) PAYMENT_OVERDUE nunca reverte uma invoice já REFUNDED", async () => {
    const s = await createScenario("overdue-on-refunded", { invoiceStatus: "REFUNDED" });
    const evId = await withSuperuser((c) => insertWebhookEvent(c, "overdue-on-refunded", "PAYMENT_OVERDUE"));
    const result = await applyEvent(
      { role: "service_role" },
      { eventType: "PAYMENT_OVERDUE", webhookEventId: evId, gatewayEventAt: new Date().toISOString(), gatewayInvoiceId: s.gatewayInvoiceId },
    );
    expect(result.rows[0]!.apply_billing_webhook_event).toBe("skipped_stale_event");
    const invoice = await loadInvoice(s.invoiceId);
    expect(invoice.status).toBe("REFUNDED");
  });

  it("16) PAYMENT_REFUNDED sobre invoice PAID transiciona para REFUNDED, sem tocar subscription/trial", async () => {
    const s = await createScenario("refund-ok", { invoiceStatus: "PAID", withActiveTrial: true, subscriptionStatus: "active" });
    const evId = await withSuperuser((c) => insertWebhookEvent(c, "refund-ok", "PAYMENT_REFUNDED"));
    const result = await applyEvent(
      { role: "service_role" },
      { eventType: "PAYMENT_REFUNDED", webhookEventId: evId, gatewayEventAt: new Date().toISOString(), gatewayInvoiceId: s.gatewayInvoiceId, gatewaySubscriptionId: s.gatewaySubscriptionId },
    );
    expect(result.rows[0]!.apply_billing_webhook_event).toBe("payment_refunded");

    const invoice = await loadInvoice(s.invoiceId);
    expect(invoice.status).toBe("REFUNDED");
    const subscription = await loadSubscription(s.subscriptionId);
    expect(subscription.status).toBe("active"); // inalterado
    const trial = await loadTrialStatus(s.tenantId);
    expect(trial).toBe("active"); // inalterado
  });

  it("17) PAYMENT_REFUNDED sobre invoice PENDING (nunca foi PAID) é descartado, sem escrita", async () => {
    const s = await createScenario("refund-on-pending");
    const evId = await withSuperuser((c) => insertWebhookEvent(c, "refund-on-pending", "PAYMENT_REFUNDED"));
    const result = await applyEvent(
      { role: "service_role" },
      { eventType: "PAYMENT_REFUNDED", webhookEventId: evId, gatewayEventAt: new Date().toISOString(), gatewayInvoiceId: s.gatewayInvoiceId },
    );
    expect(result.rows[0]!.apply_billing_webhook_event).toBe("skipped_stale_event");
    const invoice = await loadInvoice(s.invoiceId);
    expect(invoice.status).toBe("PENDING");
  });

  it("18) PAYMENT_RECEIVED nunca ativa nada e nunca avança last_gateway_event_at", async () => {
    const s = await createScenario("received-noop");
    const evId = await withSuperuser((c) => insertWebhookEvent(c, "received-noop", "PAYMENT_RECEIVED"));
    const result = await applyEvent(
      { role: "service_role" },
      { eventType: "PAYMENT_RECEIVED", webhookEventId: evId, gatewayEventAt: new Date().toISOString(), gatewayInvoiceId: s.gatewayInvoiceId, gatewaySubscriptionId: s.gatewaySubscriptionId },
    );
    expect(result.rows[0]!.apply_billing_webhook_event).toBe("noop_payment_received");

    const invoice = await loadInvoice(s.invoiceId);
    expect(invoice.status).toBe("PENDING");
    expect(invoice.last_gateway_event_at).toBeNull();
    const subscription = await loadSubscription(s.subscriptionId);
    expect(subscription.status).toBe("trialing");
  });

  it("PAYMENT_CREATED sobre a 1ª invoice (já PENDING) é sempre noop_already_pending, sem escrita", async () => {
    const s = await createScenario("created-noop");
    const evId = await withSuperuser((c) => insertWebhookEvent(c, "created-noop", "PAYMENT_CREATED"));
    const result = await applyEvent(
      { role: "service_role" },
      { eventType: "PAYMENT_CREATED", webhookEventId: evId, gatewayEventAt: new Date().toISOString(), gatewayInvoiceId: s.gatewayInvoiceId },
    );
    expect(result.rows[0]!.apply_billing_webhook_event).toBe("noop_already_pending");
    const invoice = await loadInvoice(s.invoiceId);
    expect(invoice.status).toBe("PENDING");
    expect(invoice.last_gateway_event_at).toBeNull();
  });

  it("19) SUBSCRIPTION_* nunca faz lookup de invoice e nunca altera subscriptions, mesmo sem nenhum id de gateway", async () => {
    const s = await createScenario("subscription-events", { subscriptionStatus: "active" });
    for (const eventType of ["SUBSCRIPTION_CREATED", "SUBSCRIPTION_UPDATED", "SUBSCRIPTION_INACTIVATED", "SUBSCRIPTION_DELETED"]) {
      const evId = await withSuperuser((c) => insertWebhookEvent(c, `sub-evt-${eventType}`, eventType));
      const result = await applyEvent(
        { role: "service_role" },
        { eventType, webhookEventId: evId, gatewayEventAt: new Date().toISOString(), gatewayInvoiceId: null, gatewaySubscriptionId: null },
      );
      expect(result.rows[0]!.apply_billing_webhook_event).toBe("noop_subscription_event");
    }
    const subscription = await loadSubscription(s.subscriptionId);
    expect(subscription.status).toBe("active");
    expect(subscription.current_period_start).toBeNull();
  });

  it("evento de tipo desconhecido nunca levanta exceção", async () => {
    const s = await createScenario("unknown-event");
    const evId = await withSuperuser((c) => insertWebhookEvent(c, "unknown-event", "SOME_FUTURE_EVENT"));
    const result = await applyEvent(
      { role: "service_role" },
      { eventType: "SOME_FUTURE_EVENT", webhookEventId: evId, gatewayEventAt: new Date().toISOString(), gatewayInvoiceId: s.gatewayInvoiceId },
    );
    expect(result.rows[0]!.apply_billing_webhook_event).toBe("noop_unknown_event");
  });

  it("20) nem anon nem authenticated têm EXECUTE — chamada exclusivamente por service_role", async () => {
    const s = await createScenario("grants-check");
    const evId = await withSuperuser((c) => insertWebhookEvent(c, "grants-check", "PAYMENT_OVERDUE"));

    const errAnon = await expectPgError(
      applyEvent({ role: "anon" }, { eventType: "PAYMENT_OVERDUE", webhookEventId: evId, gatewayEventAt: new Date().toISOString(), gatewayInvoiceId: s.gatewayInvoiceId }, false),
    );
    expect(errAnon.message).toMatch(/permission denied for function/i);

    const errAuth = await expectPgError(
      applyEvent(
        { role: "authenticated", userId: fx.userAOwner },
        { eventType: "PAYMENT_OVERDUE", webhookEventId: evId, gatewayEventAt: new Date().toISOString(), gatewayInvoiceId: s.gatewayInvoiceId },
        false,
      ),
    );
    expect(errAuth.message).toMatch(/permission denied for function/i);

    const okServiceRole = await applyEvent(
      { role: "service_role" },
      { eventType: "PAYMENT_OVERDUE", webhookEventId: evId, gatewayEventAt: new Date().toISOString(), gatewayInvoiceId: s.gatewayInvoiceId },
      false,
    );
    expect(okServiceRole.rows[0]!.apply_billing_webhook_event).toBe("payment_marked_failed");
  });
});
