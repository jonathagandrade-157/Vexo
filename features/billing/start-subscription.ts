import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { BillingGatewayError, type BillingGateway } from "@/lib/billing/gateway";
import {
  startBillingSubscriptionSchema,
  type StartBillingSubscriptionActionState,
  type StartBillingSubscriptionInput,
  type StartBillingSubscriptionInvoiceView,
} from "./schema";

/**
 * Etapa 20.2.6 — orquestração do fluxo TRIAL → 1ª Subscription de
 * billing. Função pura (recebe `supabase`/`gateway` por parâmetro, nunca
 * importa o registry/cliente de sessão diretamente) para ser 100%
 * testável com mocks — mesmo motivo de `features/auth/post-login-destination.ts`
 * ser separado de `features/auth/actions.ts`: nenhum teste unitário deste
 * projeto importa um arquivo `"use server"` diretamente.
 *
 * IMPORTANTE — PENDÊNCIA DE MIGRATION (ver relatório final da Etapa
 * 20.2.6): as duas chamadas RPC abaixo (`set_billing_gateway_identifiers`,
 * `create_billing_invoice`) e a permissão `billing.manage` usada por elas
 * NÃO EXISTEM AINDA no banco — foram propostas nesta etapa e aguardam
 * autorização explícita antes de qualquer migration ser criada/aplicada
 * (Etapa 20.2.4 deixou `billing_invoices` e o UPDATE de
 * `subscriptions.gateway_*` sem nenhuma policy de escrita para
 * `authenticated` de propósito — "toda escrita real... será feita por
 * função(ões) SECURITY DEFINER futuras", exatamente o que esta etapa
 * precisa agora). Até a migration ser aplicada, esta função compila e é
 * unit-testável (com `supabase.rpc` mockado), mas falha em produção/no
 * banco de teste local ao tentar chamar uma RPC inexistente — comportamento
 * esperado e documentado, nunca escondido.
 */

export interface StartBillingSubscriptionDeps {
  supabase: SupabaseClient;
  gateway: BillingGateway;
  tenantId: string;
  /** Nome/e-mail de quem está iniciando a assinatura — usados para criar o Customer no Asaas quando ainda não existe (Etapa 20.2.6 §5 — nenhum documento/CPF é enviado: `profiles.cpf_hash` é um hash irreversível, nunca o CPF em texto; coletar o documento de verdade fica para a etapa que construir o checkout real). */
  requesterName: string;
  requesterEmail: string;
}

interface PlanRow {
  id: string;
  name: string;
  monthly_price: number | null;
  yearly_price: number | null;
  is_active: boolean;
}

interface SubscriptionRow {
  id: string;
  status: string;
  gateway: string | null;
  gateway_customer_id: string | null;
  gateway_subscription_id: string | null;
}

interface BillingInvoiceRow {
  id: string;
  gateway_invoice_id: string | null;
  amount: number;
  due_at: string;
  payment_method: string | null;
  status: string;
}

const GENERIC_ERROR = "Não foi possível iniciar sua assinatura agora. Tente novamente em instantes.";

function toDate(iso: string): Date {
  return new Date(iso);
}

function addCycle(date: Date, cycle: "monthly" | "yearly"): Date {
  const next = new Date(date.getTime());
  if (cycle === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
  else next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
}

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

function mapGatewayError(err: unknown): string {
  if (err instanceof BillingGatewayError) {
    if (err.code === "TIMEOUT" || err.code === "NETWORK_ERROR") {
      return "Não conseguimos falar com o gateway de pagamento agora. Tente novamente em instantes.";
    }
    if (err.code === "RATE_LIMITED") {
      return "Muitas tentativas em pouco tempo. Aguarde um momento e tente novamente.";
    }
    return GENERIC_ERROR;
  }
  return GENERIC_ERROR;
}

function invoiceView(row: BillingInvoiceRow, fallbackBillingType: string): StartBillingSubscriptionInvoiceView {
  return {
    id: row.id,
    gatewayInvoiceId: row.gateway_invoice_id,
    amount: row.amount,
    dueAt: row.due_at,
    billingType: row.payment_method ?? fallbackBillingType,
    status: row.status,
  };
}

/**
 * PROPOSTA (RPC ainda não criada) — grava/atualiza os identificadores do
 * gateway em `subscriptions`, nunca `plan_id`/`status`/período (aqueles
 * só mudam via confirmação de webhook, etapa futura). Idempotente: pode
 * ser chamada de novo com os mesmos valores sem efeito colateral extra.
 */
async function setBillingGatewayIdentifiers(
  supabase: SupabaseClient,
  params: { tenantId: string; gatewayCustomerId: string; gatewaySubscriptionId: string | null; paymentMethod: "pix" | "card" },
): Promise<boolean> {
  const { error } = await supabase.rpc("set_billing_gateway_identifiers", {
    p_tenant_id: params.tenantId,
    p_gateway: "asaas",
    p_gateway_customer_id: params.gatewayCustomerId,
    p_gateway_subscription_id: params.gatewaySubscriptionId,
    p_payment_method: params.paymentMethod,
  });
  return !error;
}

/**
 * PROPOSTA (RPC ainda não criada) — cria a linha de `billing_invoices`
 * (sempre PENDING). O snapshot de `plan_name`/preço é decidido pelo
 * CHAMADOR (esta função), nunca recalculado a partir de `plans` dentro da
 * RPC no momento da leitura — mas a RPC proposta relê `plans.name` pelo
 * `p_plan_id` internamente como segunda camada (nunca confia cegamente
 * num texto vindo do servidor de aplicação para o snapshot histórico).
 */
async function createBillingInvoice(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    planId: string;
    amount: number;
    billingCycle: "monthly" | "yearly";
    paymentMethod: "pix" | "card";
    gatewayInvoiceId: string | null;
    periodStart: string;
    periodEnd: string;
    dueAt: string;
  },
): Promise<BillingInvoiceRow | null> {
  const { data, error } = await supabase
    .rpc("create_billing_invoice", {
      p_tenant_id: params.tenantId,
      p_gateway: "asaas",
      p_gateway_invoice_id: params.gatewayInvoiceId,
      p_plan_id: params.planId,
      p_amount: params.amount,
      p_billing_cycle: params.billingCycle,
      p_payment_method: params.paymentMethod,
      p_period_start: params.periodStart,
      p_period_end: params.periodEnd,
      p_due_at: params.dueAt,
    })
    .single();
  if (error || !data) return null;
  return data as BillingInvoiceRow;
}

/** Escolhe a cobrança mais antiga (menor `dueDate`) — a 1ª do ciclo recém-criado. */
function earliestPayment<T extends { dueDate: string }>(payments: T[]): T | null {
  if (payments.length === 0) return null;
  return [...payments].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]!;
}

async function createFirstInvoiceForNewSubscription(
  deps: StartBillingSubscriptionDeps,
  params: { plan: PlanRow; cycle: "monthly" | "yearly"; paymentMethod: "pix" | "card"; price: number; gatewaySubscriptionId: string },
): Promise<StartBillingSubscriptionActionState> {
  const { supabase, gateway } = deps;
  const { plan, cycle, paymentMethod, price, gatewaySubscriptionId } = params;

  let gatewayInvoiceId: string | null = null;
  let dueAt = todayISODate();
  try {
    // A cobrança pode levar um instante para ser gerada do lado do Asaas
    // (Etapa 20.2.5 §14) — uma segunda tentativa imediata é suficiente na
    // prática; nunca inventamos um id quando a lista vem vazia (regra 15:
    // gravamos a invoice local com gateway_invoice_id = NULL em vez de
    // travar o fluxo, para não perder o rastro da Subscription já criada).
    let payments = await gateway.listSubscriptionPayments(gatewaySubscriptionId);
    if (payments.length === 0) {
      payments = await gateway.listSubscriptionPayments(gatewaySubscriptionId);
    }
    const first = earliestPayment(payments);
    if (first) {
      gatewayInvoiceId = first.id;
      dueAt = first.dueDate;
    }
  } catch (err) {
    // Falha ao consultar a 1ª cobrança nunca derruba o fluxo inteiro — a
    // Subscription já existe no Asaas e já está persistida localmente
    // (chamador já gravou gateway_subscription_id antes de chegar aqui);
    // a invoice nasce com gateway_invoice_id NULL, pronta para ser
    // "anexada" por uma reconciliação futura (webhook/retry), nunca
    // perdida silenciosamente. Log intencional, sem PII.
    console.error("BILLING_FIRST_PAYMENT_LOOKUP_FAILED", { message: mapGatewayError(err) });
  }

  const periodStart = new Date();
  const periodEnd = addCycle(periodStart, cycle);

  const invoice = await createBillingInvoice(supabase, {
    tenantId: deps.tenantId,
    planId: plan.id,
    amount: price,
    billingCycle: cycle,
    paymentMethod,
    gatewayInvoiceId,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    dueAt: toDate(dueAt).toISOString(),
  });

  if (!invoice) {
    // Regra 15: a Subscription (e o Customer) já existem de verdade no
    // Asaas neste ponto — nunca ignorado. Uma nova tentativa do lojista
    // vai encontrar `gateway_subscription_id` já preenchido e cair no
    // caminho de recuperação (`recoverOrphanedSubscription`), que tenta
    // criar a invoice local que faltou, em vez de criar uma 2ª Subscription.
    return { status: "error", message: GENERIC_ERROR };
  }

  return { status: "success", message: "Assinatura iniciada. Conclua o pagamento para ativar.", invoice: invoiceView(invoice, paymentMethod) };
}

/**
 * Regra 15 — a loja já tem `gateway_subscription_id`, mas nenhuma
 * `billing_invoices` local (a tentativa anterior falhou entre criar a
 * Subscription no Asaas e gravar a invoice). Nunca cria uma 2ª
 * Subscription: reconsulta a que já existe e tenta completar o que
 * faltou.
 */
async function recoverOrphanedSubscription(
  deps: StartBillingSubscriptionDeps,
  params: { plan: PlanRow; cycle: "monthly" | "yearly"; paymentMethod: "pix" | "card"; price: number; gatewaySubscriptionId: string },
): Promise<StartBillingSubscriptionActionState> {
  const { gateway } = deps;
  const existing = await gateway.getSubscription(params.gatewaySubscriptionId);
  if (!existing) {
    // A Subscription não existe mais do lado do Asaas (ex.: apagada
    // manualmente) — nunca criamos uma nova silenciosamente por baixo de
    // um estado inconsistente; sinaliza para intervenção.
    return {
      status: "error",
      message: "Não foi possível confirmar sua assinatura anterior. Contate o suporte para regularizar.",
    };
  }
  return createFirstInvoiceForNewSubscription(deps, params);
}

export async function startBillingSubscription(
  deps: StartBillingSubscriptionDeps,
  rawInput: StartBillingSubscriptionInput,
): Promise<StartBillingSubscriptionActionState> {
  const parsed = startBillingSubscriptionSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { planId, cycle, paymentMethod } = parsed.data;
  const { supabase, gateway, tenantId, requesterName, requesterEmail } = deps;

  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("id, name, monthly_price, yearly_price, is_active")
    .eq("id", planId)
    .maybeSingle<PlanRow>();
  if (planError || !plan) {
    return { status: "error", message: "Plano não encontrado." };
  }
  if (!plan.is_active) {
    return { status: "error", message: "Este plano não está disponível no momento." };
  }
  const price = cycle === "monthly" ? plan.monthly_price : plan.yearly_price;
  if (price === null || price === undefined) {
    return { status: "error", message: "O preço deste plano ainda não foi definido para este ciclo." };
  }

  const { data: subscription, error: subscriptionError } = await supabase
    .from("subscriptions")
    .select("id, status, gateway, gateway_customer_id, gateway_subscription_id")
    .eq("tenant_id", tenantId)
    .maybeSingle<SubscriptionRow>();
  if (subscriptionError || !subscription) {
    return { status: "error", message: "Nenhuma assinatura de trial encontrada para esta loja." };
  }
  if (subscription.status === "active") {
    return { status: "error", message: "Esta loja já possui uma assinatura ativa." };
  }

  // ---- Idempotência: já existe uma Subscription externa para este tenant (regra 5/8) ----
  if (subscription.gateway_subscription_id) {
    const { data: existingInvoice } = await supabase
      .from("billing_invoices")
      .select("id, gateway_invoice_id, amount, due_at, payment_method, status")
      .eq("subscription_id", subscription.id)
      .eq("status", "PENDING")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<BillingInvoiceRow>();

    if (existingInvoice) {
      return {
        status: "success",
        message: "Você já tem uma cobrança pendente para esta assinatura.",
        invoice: invoiceView(existingInvoice, paymentMethod),
      };
    }

    return recoverOrphanedSubscription(deps, {
      plan,
      cycle,
      paymentMethod,
      price,
      gatewaySubscriptionId: subscription.gateway_subscription_id,
    });
  }

  // ---- Caminho novo: nenhuma Subscription externa ainda ----

  let customerId = subscription.gateway_customer_id;
  try {
    if (!customerId) {
      const customer = await gateway.createCustomer({
        name: requesterName,
        email: requesterEmail,
        externalReference: tenantId,
      });
      customerId = customer.id;

      // Persiste IMEDIATAMENTE (regra 15) — nunca perde o rastro de um
      // Customer real já criado no Asaas mesmo que a criação da
      // Subscription falhe logo em seguida.
      const persisted = await setBillingGatewayIdentifiers(supabase, {
        tenantId,
        gatewayCustomerId: customerId,
        gatewaySubscriptionId: null,
        paymentMethod,
      });
      if (!persisted) return { status: "error", message: GENERIC_ERROR };
    }
  } catch (err) {
    return { status: "error", message: mapGatewayError(err) };
  }

  let gatewaySubscriptionId: string;
  try {
    const created = await gateway.createSubscription({
      customerId,
      billingType: paymentMethod,
      cycle,
      value: price,
      nextDueDate: todayISODate(),
      description: `VEXO — plano ${plan.name}`,
      externalReference: tenantId,
    });
    gatewaySubscriptionId = created.id;
  } catch (err) {
    return { status: "error", message: mapGatewayError(err) };
  }

  const persisted = await setBillingGatewayIdentifiers(supabase, {
    tenantId,
    gatewayCustomerId: customerId,
    gatewaySubscriptionId,
    paymentMethod,
  });
  if (!persisted) {
    // A Subscription JÁ EXISTE no Asaas neste ponto (regra 15). Não há
    // como desfazer a criação externa daqui com segurança (uma requisição
    // concorrente pode já ter recuperado este mesmo estado) — nunca
    // tentamos "adivinhar" um cancelamento automático. Uma nova tentativa
    // do lojista, ou uma reconciliação futura, recupera pelo
    // gateway_subscription_id assim que a gravação local funcionar.
    return { status: "error", message: GENERIC_ERROR };
  }

  return createFirstInvoiceForNewSubscription(deps, { plan, cycle, paymentMethod, price, gatewaySubscriptionId });
}
