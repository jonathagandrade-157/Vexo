import "server-only";

import {
  BillingGatewayError,
  type BillingCustomer,
  type BillingCycle,
  type BillingErrorCode,
  type BillingGateway,
  type BillingPayment,
  type BillingPaymentMethod,
  type BillingSubscription,
  type CreateBillingCustomerInput,
  type CreateBillingSubscriptionInput,
  type UpdateBillingSubscriptionInput,
} from "./gateway";

/**
 * Implementação real para o Asaas (Etapa 20.2.5) — a conta usada é
 * SEMPRE a conta de Billing da própria VEXO, nunca uma credencial de
 * lojista. Baseado na documentação oficial pesquisada nesta etapa:
 *
 * - Autenticação: header `access_token` (NÃO `Authorization: Bearer`) —
 *   https://docs.asaas.com/docs/authentication.
 * - Sandbox: `https://sandbox.asaas.com/api/v3` (confirmado na
 *   documentação oficial). Produção: `https://api.asaas.com/v3` — a URL
 *   exata de produção não veio explícita no trecho de documentação
 *   acessível nesta pesquisa (a busca confirmou apenas "usa uma URL
 *   diferente da sandbox"); RECONFIRMAR contra
 *   https://docs.asaas.com/docs/sandbox antes do primeiro uso real em
 *   produção — mesmo cuidado já registrado para o Mercado Pago em
 *   `lib/payments/mercadopago.ts`.
 * - Customer: `POST/GET /customers` — https://docs.asaas.com/reference/create-new-customer.
 * - Subscription: `POST/GET/PUT/DELETE /subscriptions` —
 *   https://docs.asaas.com/reference/create-new-subscription,
 *   https://docs.asaas.com/reference/update-existing-subscription.
 *   IMPORTANTE (achado da pesquisa): criar uma subscription NÃO devolve
 *   o id da 1ª cobrança junto — é preciso uma chamada separada a
 *   `GET /subscriptions/{id}/payments` para obtê-lo. Esta etapa não
 *   implementa esse método (nenhum fluxo desta etapa precisa dele ainda
 *   — fica para a Etapa 20.2.6/20.2.7, quando o fluxo de 1ª assinatura
 *   for de fato construído).
 * - Payment: `GET /payments/{id}` —
 *   https://docs.asaas.com/reference/create-new-payment (mesma família
 *   de endpoints da consulta de payment individual).
 * - Formato de erro: `{ "errors": [ { "code": "...", "description": "..." } ] }`.
 *
 * NÃO implementado nesta etapa (fora do escopo, ver Etapa 20.2.5 §objetivo):
 * verificação de webhook e parse de evento. A pesquisa encontrou que a
 * autenticação de webhook do Asaas é um token estático no header
 * `asaas-access-token` (comparado a um valor configurado ao cadastrar o
 * webhook) — mecanismo diferente da assinatura HMAC do Mercado Pago — e
 * que a lista de eventos de payment/subscription é ampla (documentada no
 * relatório desta etapa). Mas não ficou confirmado nesta pesquisa se o
 * payload clássico do Asaas inclui um id de evento estável e distinto do
 * id do payment/subscription (necessário para a chave de idempotência
 * `UNIQUE(provider, event_id)` de `billing_webhook_events`, Etapa
 * 20.2.4) — isso precisa ser confirmado com um payload real de sandbox
 * antes da Etapa 20.2.6 desenhar o webhook, não decidido por suposição
 * aqui.
 */

const DEFAULT_TIMEOUT_MS = 10_000;

interface AsaasErrorBody {
  errors?: { code?: string; description?: string }[];
}

interface AsaasCustomerResponse {
  id: string;
  name: string;
  email: string;
  externalReference: string | null;
}

interface AsaasSubscriptionResponse {
  id: string;
  customer: string;
  status: string;
  billingType: string;
  cycle: string;
  value: number;
  nextDueDate: string;
  externalReference: string | null;
}

interface AsaasPaymentResponse {
  id: string;
  subscription: string | null;
  customer: string;
  status: string;
  value: number;
  billingType: string;
  dueDate: string;
  paymentDate: string | null;
}

function toAsaasCycle(cycle: BillingCycle): string {
  return cycle === "monthly" ? "MONTHLY" : "YEARLY";
}

function toAsaasBillingType(method: BillingPaymentMethod): string {
  return method === "pix" ? "PIX" : "CREDIT_CARD";
}

function mapCustomer(data: AsaasCustomerResponse): BillingCustomer {
  return {
    id: data.id,
    name: data.name,
    email: data.email,
    externalReference: data.externalReference ?? null,
  };
}

function mapSubscription(data: AsaasSubscriptionResponse): BillingSubscription {
  return {
    id: data.id,
    customerId: data.customer,
    status: data.status,
    billingType: data.billingType,
    cycle: data.cycle,
    value: data.value,
    nextDueDate: data.nextDueDate,
    externalReference: data.externalReference ?? null,
  };
}

function mapPayment(data: AsaasPaymentResponse): BillingPayment {
  return {
    id: data.id,
    subscriptionId: data.subscription ?? null,
    customerId: data.customer,
    status: data.status,
    value: data.value,
    billingType: data.billingType,
    dueDate: data.dueDate,
    paymentDate: data.paymentDate ?? null,
  };
}

function statusToErrorCode(status: number): BillingErrorCode {
  if (status === 400) return "BAD_REQUEST";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVER_ERROR";
  return "UNKNOWN";
}

/**
 * Extrai a descrição de erro do formato oficial `{ errors: [{ code,
 * description }] }` — nunca ecoa o corpo bruto da resposta (poderia,
 * em tese, conter algo que não deveria ir para uma mensagem de erro
 * de aplicação) e nunca inclui nada da requisição (API key nunca
 * aparece aqui, por construção — esta função só olha a RESPOSTA).
 */
function extractErrorDescription(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const body = data as AsaasErrorBody;
  const first = Array.isArray(body.errors) ? body.errors[0] : undefined;
  return first?.description ?? null;
}

export function createAsaasGateway(apiKey: string, baseUrl: string, timeoutMs = DEFAULT_TIMEOUT_MS): BillingGateway {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          // Header oficial do Asaas — nunca `authorization: Bearer` (isso
          // é o mecanismo do Mercado Pago, não do Asaas). Nunca logado:
          // esta função nunca grava `headers`/`init` em nenhum lugar, só
          // usa para a própria chamada.
          access_token: apiKey,
          "user-agent": "VEXO-Billing/1.0",
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === "AbortError") {
        throw new BillingGatewayError({
          provider: "asaas",
          status: null,
          code: "TIMEOUT",
          message: `asaas: request to ${path} timed out after ${timeoutMs}ms`,
          retryable: true,
        });
      }
      throw new BillingGatewayError({
        provider: "asaas",
        status: null,
        code: "NETWORK_ERROR",
        message: `asaas: network error calling ${path}`,
        retryable: true,
      });
    }
    clearTimeout(timeoutId);

    if (response.status === 204) {
      return undefined as T;
    }

    const raw = await response.text();
    let data: unknown = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        throw new BillingGatewayError({
          provider: "asaas",
          status: response.status,
          code: "INVALID_RESPONSE",
          message: `asaas: malformed (non-JSON) response body from ${path}`,
          retryable: response.status >= 500,
        });
      }
    }

    if (!response.ok) {
      const description = extractErrorDescription(data);
      throw new BillingGatewayError({
        provider: "asaas",
        status: response.status,
        code: statusToErrorCode(response.status),
        message: `asaas: request to ${path} failed (${response.status})${description ? `: ${description}` : ""}`,
        retryable: response.status === 429 || response.status >= 500,
      });
    }

    return data as T;
  }

  async function getOrNull<T>(path: string): Promise<T | null> {
    try {
      return await request<T>("GET", path);
    } catch (err) {
      if (err instanceof BillingGatewayError && err.status === 404) return null;
      throw err;
    }
  }

  return {
    provider: "asaas",

    async createCustomer(input: CreateBillingCustomerInput): Promise<BillingCustomer> {
      const data = await request<AsaasCustomerResponse>("POST", "/customers", {
        name: input.name,
        email: input.email,
        cpfCnpj: input.document,
        externalReference: input.externalReference,
      });
      return mapCustomer(data);
    },

    async getCustomer(customerId: string): Promise<BillingCustomer | null> {
      const data = await getOrNull<AsaasCustomerResponse>(`/customers/${encodeURIComponent(customerId)}`);
      return data ? mapCustomer(data) : null;
    },

    async createSubscription(input: CreateBillingSubscriptionInput): Promise<BillingSubscription> {
      const data = await request<AsaasSubscriptionResponse>("POST", "/subscriptions", {
        customer: input.customerId,
        billingType: toAsaasBillingType(input.billingType),
        cycle: toAsaasCycle(input.cycle),
        value: input.value,
        nextDueDate: input.nextDueDate,
        description: input.description,
        externalReference: input.externalReference,
      });
      return mapSubscription(data);
    },

    async getSubscription(subscriptionId: string): Promise<BillingSubscription | null> {
      const data = await getOrNull<AsaasSubscriptionResponse>(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
      return data ? mapSubscription(data) : null;
    },

    async updateSubscription(subscriptionId: string, input: UpdateBillingSubscriptionInput): Promise<BillingSubscription> {
      const data = await request<AsaasSubscriptionResponse>("PUT", `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
        value: input.value,
        cycle: input.cycle ? toAsaasCycle(input.cycle) : undefined,
        billingType: input.billingType ? toAsaasBillingType(input.billingType) : undefined,
        nextDueDate: input.nextDueDate,
      });
      return mapSubscription(data);
    },

    async cancelSubscription(subscriptionId: string): Promise<void> {
      await request<void>("DELETE", `/subscriptions/${encodeURIComponent(subscriptionId)}`);
    },

    async getPayment(paymentId: string): Promise<BillingPayment | null> {
      const data = await getOrNull<AsaasPaymentResponse>(`/payments/${encodeURIComponent(paymentId)}`);
      return data ? mapPayment(data) : null;
    },

    async listSubscriptionPayments(subscriptionId: string): Promise<BillingPayment[]> {
      // Envelope de listagem padrão do Asaas ({ object: "list", data: [...],
      // hasMore, totalCount, limit, offset }) — mesmo formato documentado
      // em todo endpoint de listagem do Asaas (ex.: list-subscriptions).
      // O endpoint em si está confirmado
      // (https://docs.asaas.com/reference/list-payments-of-a-subscription);
      // a pesquisa desta etapa não retornou o corpo de exemplo exato desta
      // rota específica — RECONFIRMAR contra uma resposta real de sandbox
      // antes de depender disto em produção (mesma ressalva já registrada
      // para a URL de produção em `docs/architecture/etapa-20-billing-asaas.md`).
      const data = await request<{ data: AsaasPaymentResponse[] }>(
        "GET",
        `/subscriptions/${encodeURIComponent(subscriptionId)}/payments`,
      );
      return (data.data ?? []).map(mapPayment);
    },
  };
}
