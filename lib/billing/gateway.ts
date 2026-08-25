import "server-only";

/**
 * Abstração de gateway de BILLING (Etapa 20.2.5) — cobrança do LOJISTA
 * pela assinatura do VEXO. Deliberadamente uma interface própria, NÃO
 * `PaymentGateway` (`lib/payments/gateway.ts`): aquela é sobre o cliente
 * final pagando a loja através da conta Mercado Pago do próprio lojista
 * (OAuth Connect); esta é sobre o VEXO cobrando o lojista através da
 * conta de Billing da própria VEXO — contextos, credenciais e ciclo de
 * vida completamente diferentes (Etapa 20.2.1 §2, Etapa 20.2.3 §1).
 * Nunca compartilhar tipo, arquivo ou credencial entre as duas.
 *
 * Só os métodos que a Etapa 20.2.3 (desenho) e a documentação oficial do
 * Asaas realmente sustentam nesta camada — sem antecipar operações que
 * nenhum fluxo futuro definido usa ainda (ex.: sem `createPayment`
 * avulso: no desenho aprovado, toda cobrança de billing nasce de uma
 * Subscription, nunca de uma cobrança solta). Webhook (verificação de
 * assinatura/token, parse de evento) fica FORA desta interface de
 * propósito — é escopo da Etapa 20.2.6, que vai pesquisar o formato real
 * de payload/idempotência do Asaas antes de desenhar isso; esta etapa é
 * só o cliente request/response.
 */

export type BillingProvider = "asaas" | "stripe" | "iugu" | "pagarme" | "pagbank";

/** Mesmo vocabulário de `public.subscriptions.billing_cycle`/`public.billing_invoices.billing_cycle` (Etapa 20.2.4) — nunca diverge do CHECK do banco. */
export type BillingCycle = "monthly" | "yearly";

/** Mesmo vocabulário de `public.subscriptions.payment_method`/`public.billing_invoices.payment_method` (Etapa 20.2.4). */
export type BillingPaymentMethod = "pix" | "card";

export interface CreateBillingCustomerInput {
  name: string;
  email: string;
  /**
   * Sempre o `tenant_id` do VEXO — nunca um dado solto do lojista. É a
   * âncora de reconciliação do lado do gateway (o Asaas não impede
   * clientes duplicados por conta própria) e, futuramente, o que um
   * webhook usaria para cruzar de volta com `subscriptions`, mesmo
   * princípio de `store_payment_providers.connected_account_id` — nunca
   * resolver identidade por nome/e-mail.
   */
  externalReference: string;
  /** CPF/CNPJ do responsável pela conta — o Asaas exige para cobrança recorrente real de cartão/Pix; opcional aqui porque esta etapa nunca cria cliente real. */
  document?: string;
}

export interface BillingCustomer {
  id: string;
  name: string;
  email: string;
  externalReference: string | null;
}

export interface CreateBillingSubscriptionInput {
  customerId: string;
  billingType: BillingPaymentMethod;
  cycle: BillingCycle;
  /** Sempre o valor já resolvido pelo VEXO (snapshot do plano) — nunca um valor vindo do cliente/navegador. */
  value: number;
  /** Data (YYYY-MM-DD) da primeira cobrança do ciclo. */
  nextDueDate: string;
  description?: string;
  /** Sempre o `tenant_id` — mesmo princípio de `CreateBillingCustomerInput.externalReference`. */
  externalReference: string;
}

export interface UpdateBillingSubscriptionInput {
  value?: number;
  cycle?: BillingCycle;
  billingType?: BillingPaymentMethod;
  nextDueDate?: string;
}

export interface BillingSubscription {
  id: string;
  customerId: string;
  /**
   * Status bruto do gateway, sem tradução para o vocabulário do VEXO —
   * mesmo princípio de `billing_invoices.raw_gateway_status` (Etapa
   * 20.2.4): mapear isso para `subscriptions.status` é decisão da etapa
   * que vai processar webhooks de verdade (20.2.6/20.2.7), não desta
   * camada de transporte.
   */
  status: string;
  billingType: string;
  cycle: string;
  value: number;
  nextDueDate: string;
  externalReference: string | null;
}

export interface BillingPayment {
  id: string;
  subscriptionId: string | null;
  customerId: string;
  /** Status bruto do gateway — mesmo motivo de `BillingSubscription.status`. */
  status: string;
  value: number;
  billingType: string;
  dueDate: string;
  paymentDate: string | null;
}

export type BillingErrorCode =
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "BAD_REQUEST"
  | "SERVER_ERROR"
  | "UNKNOWN";

/**
 * Erro tipado único de toda a camada de billing (Etapa 20.2.5 §7/§13) —
 * nunca um `Error` genérico. `message` nunca inclui a API key (só monta
 * a partir de status HTTP + descrição devolvida pelo gateway, nunca dos
 * headers da requisição) — auditável por `grep` no código-fonte, não só
 * por convenção. `retryable` existe para a etapa futura de dunning
 * (Etapa 20.2.3 §9) decidir sem duplicar essa lógica em cada chamador.
 */
export class BillingGatewayError extends Error {
  readonly provider: BillingProvider;
  readonly status: number | null;
  readonly code: BillingErrorCode;
  readonly retryable: boolean;

  constructor(params: {
    provider: BillingProvider;
    status: number | null;
    code: BillingErrorCode;
    message: string;
    retryable: boolean;
  }) {
    super(params.message);
    this.name = "BillingGatewayError";
    this.provider = params.provider;
    this.status = params.status;
    this.code = params.code;
    this.retryable = params.retryable;
  }
}

export interface BillingGateway {
  readonly provider: BillingProvider;
  createCustomer(input: CreateBillingCustomerInput): Promise<BillingCustomer>;
  getCustomer(customerId: string): Promise<BillingCustomer | null>;
  createSubscription(input: CreateBillingSubscriptionInput): Promise<BillingSubscription>;
  getSubscription(subscriptionId: string): Promise<BillingSubscription | null>;
  updateSubscription(subscriptionId: string, input: UpdateBillingSubscriptionInput): Promise<BillingSubscription>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  getPayment(paymentId: string): Promise<BillingPayment | null>;
}
