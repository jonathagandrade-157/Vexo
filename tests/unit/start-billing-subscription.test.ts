import { describe, expect, it, vi } from "vitest";
import { startBillingSubscription } from "@/features/billing/start-subscription";
import { BillingGatewayError, type BillingGateway } from "@/lib/billing/gateway";

/**
 * Etapa 20.2.6 — testa a lógica pura de orquestração com Supabase e
 * BillingGateway totalmente mockados (nenhuma chamada real de rede,
 * nenhum banco real tocado). As RPCs `set_billing_gateway_identifiers`/
 * `create_billing_invoice` ainda NÃO existem no banco (propostas nesta
 * etapa, aguardando autorização) — aqui elas são simuladas via
 * `supabase.rpc` mockado, validando que a função monta exatamente os
 * parâmetros esperados. Testes de integração real (RLS/permissão
 * `billing.manage`) ficam para depois que a migration for aplicada.
 */

const TENANT_ID = "tenant-abc";
const PLAN_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

function rpcResult<T>(result: { data?: T | null; error?: unknown }) {
  const promise = Promise.resolve(result);
  return Object.assign(promise, { single: () => Promise.resolve(result) });
}

interface MockConfig {
  plan?: { data: unknown; error?: unknown };
  subscription?: { data: unknown; error?: unknown };
  existingInvoice?: { data: unknown; error?: unknown };
  rpcResults?: Record<string, { data?: unknown; error?: unknown }>;
}

function createSupabaseMock(config: MockConfig) {
  const rpc = vi.fn((name: string) => rpcResult(config.rpcResults?.[name] ?? { data: null, error: null }));

  const from = vi.fn((table: string) => {
    if (table === "plans") {
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(config.plan ?? { data: null, error: null }) }) }) };
    }
    if (table === "subscriptions") {
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(config.subscription ?? { data: null, error: null }) }) }) };
    }
    if (table === "billing_invoices") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () => Promise.resolve(config.existingInvoice ?? { data: null, error: null }),
                }),
              }),
            }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table in test mock: ${table}`);
  });

  return { from, rpc } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

function createGatewayMock(overrides: Partial<BillingGateway> = {}): BillingGateway {
  return {
    provider: "asaas",
    createCustomer: vi.fn().mockResolvedValue({ id: "cus_new", name: "X", email: "x@x.com", externalReference: TENANT_ID }),
    getCustomer: vi.fn(),
    createSubscription: vi.fn().mockResolvedValue({
      id: "sub_new",
      customerId: "cus_new",
      status: "ACTIVE",
      billingType: "PIX",
      cycle: "MONTHLY",
      value: 49.9,
      nextDueDate: "2026-09-01",
      externalReference: TENANT_ID,
    }),
    getSubscription: vi.fn(),
    updateSubscription: vi.fn(),
    cancelSubscription: vi.fn(),
    getPayment: vi.fn(),
    listSubscriptionPayments: vi.fn().mockResolvedValue([
      { id: "pay_1", subscriptionId: "sub_new", customerId: "cus_new", status: "PENDING", value: 49.9, billingType: "PIX", dueDate: "2026-09-01", paymentDate: null },
    ]),
    ...overrides,
  };
}

const ACTIVE_PLAN = { id: PLAN_ID, name: "Basic", monthly_price: 49.9, yearly_price: 499, is_active: true };
const TRIALING_SUBSCRIPTION = { id: "sub-row-1", status: "trialing", gateway: null, gateway_customer_id: null, gateway_subscription_id: null };

describe("startBillingSubscription", () => {
  it("plano mensal válido: cria Customer, Subscription, e a invoice PENDING", async () => {
    const supabase = createSupabaseMock({
      plan: { data: ACTIVE_PLAN },
      subscription: { data: TRIALING_SUBSCRIPTION },
      rpcResults: {
        set_billing_gateway_identifiers: { error: null },
        create_billing_invoice: { data: { id: "inv-1", gateway_invoice_id: "pay_1", amount: 49.9, due_at: "2026-09-01T00:00:00.000Z", payment_method: "pix", status: "PENDING" } },
      },
    });
    const gateway = createGatewayMock();

    const result = await startBillingSubscription(
      { supabase, gateway, tenantId: TENANT_ID, requesterName: "Dono", requesterEmail: "dono@x.com" },
      { planId: PLAN_ID, cycle: "monthly", paymentMethod: "pix" },
    );

    expect(result.status).toBe("success");
    expect(result.invoice).toMatchObject({ id: "inv-1", gatewayInvoiceId: "pay_1", status: "PENDING" });
    expect(gateway.createCustomer).toHaveBeenCalledWith({ name: "Dono", email: "dono@x.com", externalReference: TENANT_ID });
    expect(gateway.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "cus_new", billingType: "pix", cycle: "monthly", value: 49.9 }),
    );
  });

  it("plano anual válido: usa yearly_price como snapshot", async () => {
    const supabase = createSupabaseMock({
      plan: { data: ACTIVE_PLAN },
      subscription: { data: TRIALING_SUBSCRIPTION },
      rpcResults: {
        set_billing_gateway_identifiers: { error: null },
        create_billing_invoice: { data: { id: "inv-2", gateway_invoice_id: "pay_1", amount: 499, due_at: "2026-09-01T00:00:00.000Z", payment_method: "card", status: "PENDING" } },
      },
    });
    const gateway = createGatewayMock();

    const result = await startBillingSubscription(
      { supabase, gateway, tenantId: TENANT_ID, requesterName: "Dono", requesterEmail: "dono@x.com" },
      { planId: PLAN_ID, cycle: "yearly", paymentMethod: "card" },
    );

    expect(result.status).toBe("success");
    expect(gateway.createSubscription).toHaveBeenCalledWith(expect.objectContaining({ value: 499, cycle: "yearly", billingType: "card" }));
  });

  it("plano inexistente → erro, nenhuma chamada ao gateway", async () => {
    const supabase = createSupabaseMock({ plan: { data: null } });
    const gateway = createGatewayMock();
    const result = await startBillingSubscription(
      { supabase, gateway, tenantId: TENANT_ID, requesterName: "D", requesterEmail: "d@x.com" },
      { planId: PLAN_ID, cycle: "monthly", paymentMethod: "pix" },
    );
    expect(result).toMatchObject({ status: "error", message: "Plano não encontrado." });
    expect(gateway.createCustomer).not.toHaveBeenCalled();
  });

  it("plano inativo → erro", async () => {
    const supabase = createSupabaseMock({ plan: { data: { ...ACTIVE_PLAN, is_active: false } } });
    const gateway = createGatewayMock();
    const result = await startBillingSubscription(
      { supabase, gateway, tenantId: TENANT_ID, requesterName: "D", requesterEmail: "d@x.com" },
      { planId: PLAN_ID, cycle: "monthly", paymentMethod: "pix" },
    );
    expect(result).toMatchObject({ status: "error", message: "Este plano não está disponível no momento." });
  });

  it("preço NULL para o ciclo escolhido → erro, nunca inventa valor", async () => {
    const supabase = createSupabaseMock({ plan: { data: { ...ACTIVE_PLAN, monthly_price: null } } });
    const gateway = createGatewayMock();
    const result = await startBillingSubscription(
      { supabase, gateway, tenantId: TENANT_ID, requesterName: "D", requesterEmail: "d@x.com" },
      { planId: PLAN_ID, cycle: "monthly", paymentMethod: "pix" },
    );
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/preço/i);
    expect(gateway.createCustomer).not.toHaveBeenCalled();
  });

  it("método de pagamento inválido → erro de validação, nada é chamado", async () => {
    const supabase = createSupabaseMock({});
    const gateway = createGatewayMock();
    const result = await startBillingSubscription(
      { supabase, gateway, tenantId: TENANT_ID, requesterName: "D", requesterEmail: "d@x.com" },
      { planId: PLAN_ID, cycle: "monthly", paymentMethod: "boleto" as never },
    );
    expect(result.status).toBe("error");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("ciclo inválido → erro de validação, nada é chamado", async () => {
    const supabase = createSupabaseMock({});
    const gateway = createGatewayMock();
    const result = await startBillingSubscription(
      { supabase, gateway, tenantId: TENANT_ID, requesterName: "D", requesterEmail: "d@x.com" },
      { planId: PLAN_ID, cycle: "weekly" as never, paymentMethod: "pix" },
    );
    expect(result.status).toBe("error");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("Customer existente (gateway_customer_id já preenchido): nunca chama createCustomer de novo", async () => {
    const supabase = createSupabaseMock({
      plan: { data: ACTIVE_PLAN },
      subscription: { data: { ...TRIALING_SUBSCRIPTION, gateway_customer_id: "cus_existing" } },
      rpcResults: {
        set_billing_gateway_identifiers: { error: null },
        create_billing_invoice: { data: { id: "inv-3", gateway_invoice_id: "pay_1", amount: 49.9, due_at: "2026-09-01T00:00:00.000Z", payment_method: "pix", status: "PENDING" } },
      },
    });
    const gateway = createGatewayMock();

    await startBillingSubscription(
      { supabase, gateway, tenantId: TENANT_ID, requesterName: "D", requesterEmail: "d@x.com" },
      { planId: PLAN_ID, cycle: "monthly", paymentMethod: "pix" },
    );

    expect(gateway.createCustomer).not.toHaveBeenCalled();
    expect(gateway.createSubscription).toHaveBeenCalledWith(expect.objectContaining({ customerId: "cus_existing" }));
  });

  it("tentativa duplicada (já existe billing_invoice PENDING para a subscription existente) → retorna a existente, nunca cria uma nova Subscription", async () => {
    const supabase = createSupabaseMock({
      plan: { data: ACTIVE_PLAN },
      subscription: { data: { ...TRIALING_SUBSCRIPTION, gateway_subscription_id: "sub_existing", gateway_customer_id: "cus_existing" } },
      existingInvoice: { data: { id: "inv-existing", gateway_invoice_id: "pay_existing", amount: 49.9, due_at: "2026-09-01T00:00:00.000Z", payment_method: "pix", status: "PENDING" } },
    });
    const gateway = createGatewayMock();

    const result = await startBillingSubscription(
      { supabase, gateway, tenantId: TENANT_ID, requesterName: "D", requesterEmail: "d@x.com" },
      { planId: PLAN_ID, cycle: "monthly", paymentMethod: "pix" },
    );

    expect(result.status).toBe("success");
    expect(result.invoice?.id).toBe("inv-existing");
    expect(gateway.createCustomer).not.toHaveBeenCalled();
    expect(gateway.createSubscription).not.toHaveBeenCalled();
  });

  it("recuperação: gateway_subscription_id existe mas nenhuma invoice local (falha anterior) → recupera sem criar 2ª Subscription", async () => {
    const supabase = createSupabaseMock({
      plan: { data: ACTIVE_PLAN },
      subscription: { data: { ...TRIALING_SUBSCRIPTION, gateway_subscription_id: "sub_orphan", gateway_customer_id: "cus_existing" } },
      existingInvoice: { data: null },
      rpcResults: {
        create_billing_invoice: { data: { id: "inv-recovered", gateway_invoice_id: "pay_1", amount: 49.9, due_at: "2026-09-01T00:00:00.000Z", payment_method: "pix", status: "PENDING" } },
      },
    });
    const gateway = createGatewayMock({
      getSubscription: vi.fn().mockResolvedValue({ id: "sub_orphan", customerId: "cus_existing", status: "ACTIVE", billingType: "PIX", cycle: "MONTHLY", value: 49.9, nextDueDate: "2026-09-01", externalReference: TENANT_ID }),
    });

    const result = await startBillingSubscription(
      { supabase, gateway, tenantId: TENANT_ID, requesterName: "D", requesterEmail: "d@x.com" },
      { planId: PLAN_ID, cycle: "monthly", paymentMethod: "pix" },
    );

    expect(result.status).toBe("success");
    expect(result.invoice?.id).toBe("inv-recovered");
    expect(gateway.createSubscription).not.toHaveBeenCalled();
    expect(gateway.createCustomer).not.toHaveBeenCalled();
  });

  it("1ª cobrança encontrada → gatewayInvoiceId vem da cobrança mais antiga da lista", async () => {
    const supabase = createSupabaseMock({
      plan: { data: ACTIVE_PLAN },
      subscription: { data: TRIALING_SUBSCRIPTION },
      rpcResults: {
        set_billing_gateway_identifiers: { error: null },
        create_billing_invoice: { data: { id: "inv-4", gateway_invoice_id: "pay_early", amount: 49.9, due_at: "2026-09-01T00:00:00.000Z", payment_method: "pix", status: "PENDING" } },
      },
    });
    const gateway = createGatewayMock({
      listSubscriptionPayments: vi.fn().mockResolvedValue([
        { id: "pay_late", subscriptionId: "sub_new", customerId: "cus_new", status: "PENDING", value: 49.9, billingType: "PIX", dueDate: "2026-10-01", paymentDate: null },
        { id: "pay_early", subscriptionId: "sub_new", customerId: "cus_new", status: "PENDING", value: 49.9, billingType: "PIX", dueDate: "2026-09-01", paymentDate: null },
      ]),
    });

    const result = await startBillingSubscription(
      { supabase, gateway, tenantId: TENANT_ID, requesterName: "D", requesterEmail: "d@x.com" },
      { planId: PLAN_ID, cycle: "monthly", paymentMethod: "pix" },
    );

    expect(result.status).toBe("success");
    expect(result.invoice?.gatewayInvoiceId).toBe("pay_early");
  });

  it("1ª cobrança NÃO encontrada (lista vazia mesmo após 2ª tentativa) → cria a invoice local com gateway_invoice_id NULL, nunca trava o fluxo", async () => {
    const supabase = createSupabaseMock({
      plan: { data: ACTIVE_PLAN },
      subscription: { data: TRIALING_SUBSCRIPTION },
      rpcResults: {
        set_billing_gateway_identifiers: { error: null },
        create_billing_invoice: { data: { id: "inv-5", gateway_invoice_id: null, amount: 49.9, due_at: expect.any(String), payment_method: "pix", status: "PENDING" } },
      },
    });
    const gateway = createGatewayMock({ listSubscriptionPayments: vi.fn().mockResolvedValue([]) });

    const result = await startBillingSubscription(
      { supabase, gateway, tenantId: TENANT_ID, requesterName: "D", requesterEmail: "d@x.com" },
      { planId: PLAN_ID, cycle: "monthly", paymentMethod: "pix" },
    );

    expect(result.status).toBe("success");
    expect(result.invoice?.gatewayInvoiceId).toBeNull();
    expect(gateway.listSubscriptionPayments).toHaveBeenCalledTimes(2);
  });

  it("nunca marca subscriptions.status como active nem chama update direto na tabela — só a RPC set_billing_gateway_identifiers", async () => {
    const supabase = createSupabaseMock({
      plan: { data: ACTIVE_PLAN },
      subscription: { data: TRIALING_SUBSCRIPTION },
      rpcResults: {
        set_billing_gateway_identifiers: { error: null },
        create_billing_invoice: { data: { id: "inv-6", gateway_invoice_id: "pay_1", amount: 49.9, due_at: "2026-09-01T00:00:00.000Z", payment_method: "pix", status: "PENDING" } },
      },
    });
    const gateway = createGatewayMock();

    await startBillingSubscription(
      { supabase, gateway, tenantId: TENANT_ID, requesterName: "D", requesterEmail: "d@x.com" },
      { planId: PLAN_ID, cycle: "monthly", paymentMethod: "pix" },
    );

    // Duas chamadas a set_billing_gateway_identifiers são esperadas por
    // design (regra 15): uma logo após criar o Customer (gatewaySubscriptionId
    // ainda null) e outra logo após criar a Subscription — nunca perdendo o
    // rastro de uma criação externa já feita se o passo seguinte falhar.
    const rpcCalls = vi.mocked(supabase.rpc).mock.calls.map(([name]) => name);
    expect(rpcCalls).toEqual(["set_billing_gateway_identifiers", "set_billing_gateway_identifiers", "create_billing_invoice"]);
    // Nenhuma chamada de rpc pede para mudar status/plan_id — a única RPC
    // que toca subscriptions (proposta) só recebe identificadores de
    // gateway, nunca status/plan_id.
    for (const [name, params] of vi.mocked(supabase.rpc).mock.calls) {
      if (name === "set_billing_gateway_identifiers") {
        expect(params).not.toHaveProperty("p_status");
        expect(params).not.toHaveProperty("p_plan_id");
      }
    }
  });

  it("nunca converte trial (trial_records nunca é referenciado)", async () => {
    const supabase = createSupabaseMock({
      plan: { data: ACTIVE_PLAN },
      subscription: { data: TRIALING_SUBSCRIPTION },
      rpcResults: {
        set_billing_gateway_identifiers: { error: null },
        create_billing_invoice: { data: { id: "inv-7", gateway_invoice_id: "pay_1", amount: 49.9, due_at: "2026-09-01T00:00:00.000Z", payment_method: "pix", status: "PENDING" } },
      },
    });
    const gateway = createGatewayMock();

    await startBillingSubscription(
      { supabase, gateway, tenantId: TENANT_ID, requesterName: "D", requesterEmail: "d@x.com" },
      { planId: PLAN_ID, cycle: "monthly", paymentMethod: "pix" },
    );

    const tablesTouched = vi.mocked(supabase.from).mock.calls.map(([table]) => table);
    expect(tablesTouched).not.toContain("trial_records");
  });

  it("erro genérico da API do gateway → mensagem amigável, nunca vaza detalhe interno", async () => {
    const supabase = createSupabaseMock({ plan: { data: ACTIVE_PLAN }, subscription: { data: TRIALING_SUBSCRIPTION } });
    const gateway = createGatewayMock({
      createCustomer: vi.fn().mockRejectedValue(new BillingGatewayError({ provider: "asaas", status: 400, code: "BAD_REQUEST", message: "asaas: request failed (400)", retryable: false })),
    });
    const result = await startBillingSubscription(
      { supabase, gateway, tenantId: TENANT_ID, requesterName: "D", requesterEmail: "d@x.com" },
      { planId: PLAN_ID, cycle: "monthly", paymentMethod: "pix" },
    );
    expect(result.status).toBe("error");
    expect(result.message).not.toMatch(/asaas:/i);
  });

  it("timeout do gateway → mensagem específica de indisponibilidade", async () => {
    const supabase = createSupabaseMock({ plan: { data: ACTIVE_PLAN }, subscription: { data: TRIALING_SUBSCRIPTION } });
    const gateway = createGatewayMock({
      createCustomer: vi.fn().mockRejectedValue(new BillingGatewayError({ provider: "asaas", status: null, code: "TIMEOUT", message: "timeout", retryable: true })),
    });
    const result = await startBillingSubscription(
      { supabase, gateway, tenantId: TENANT_ID, requesterName: "D", requesterEmail: "d@x.com" },
      { planId: PLAN_ID, cycle: "monthly", paymentMethod: "pix" },
    );
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/não conseguimos falar/i);
  });

  it("Asaas 429 (rate limited) → mensagem pedindo para aguardar", async () => {
    const supabase = createSupabaseMock({ plan: { data: ACTIVE_PLAN }, subscription: { data: TRIALING_SUBSCRIPTION } });
    const gateway = createGatewayMock({
      createCustomer: vi.fn().mockRejectedValue(new BillingGatewayError({ provider: "asaas", status: 429, code: "RATE_LIMITED", message: "rate limited", retryable: true })),
    });
    const result = await startBillingSubscription(
      { supabase, gateway, tenantId: TENANT_ID, requesterName: "D", requesterEmail: "d@x.com" },
      { planId: PLAN_ID, cycle: "monthly", paymentMethod: "pix" },
    );
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/aguarde/i);
  });

  it("nenhuma assinatura de trial encontrada para o tenant → erro claro", async () => {
    const supabase = createSupabaseMock({ plan: { data: ACTIVE_PLAN }, subscription: { data: null } });
    const gateway = createGatewayMock();
    const result = await startBillingSubscription(
      { supabase, gateway, tenantId: TENANT_ID, requesterName: "D", requesterEmail: "d@x.com" },
      { planId: PLAN_ID, cycle: "monthly", paymentMethod: "pix" },
    );
    expect(result).toMatchObject({ status: "error", message: "Nenhuma assinatura de trial encontrada para esta loja." });
  });

  it("loja já com assinatura ACTIVE → bloqueia, nunca tenta criar outra", async () => {
    const supabase = createSupabaseMock({ plan: { data: ACTIVE_PLAN }, subscription: { data: { ...TRIALING_SUBSCRIPTION, status: "active" } } });
    const gateway = createGatewayMock();
    const result = await startBillingSubscription(
      { supabase, gateway, tenantId: TENANT_ID, requesterName: "D", requesterEmail: "d@x.com" },
      { planId: PLAN_ID, cycle: "monthly", paymentMethod: "pix" },
    );
    expect(result.status).toBe("error");
    expect(gateway.createCustomer).not.toHaveBeenCalled();
  });
});
