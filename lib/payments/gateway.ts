import "server-only";

/**
 * Abstração de gateway de pagamento (arquitetura Etapa 11 §2) — checkout
 * e webhook falam só com esta interface, nunca com um provedor
 * específico diretamente. Só Mercado Pago é implementado nesta etapa
 * (`mercadopago.ts`); PagBank/Asaas/Stripe entram depois só adicionando
 * um novo arquivo + um `case` em `registry.ts`, sem tocar checkout ou
 * webhook.
 */

export type PaymentProvider = "mercadopago";

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Identificador da conta conectada no provedor (ex.: `user_id` do Mercado Pago) — nunca um segredo. */
  providerAccountId: string;
  expiresAt: Date | null;
}

export interface CreatePaymentInput {
  accessToken: string;
  orderId: string;
  orderNumber: string;
  /** Sempre `orders.total` já calculado pelo servidor (Etapa 10) — o gateway nunca recebe um valor vindo do cliente. */
  amount: number;
  customerEmail: string;
  /** URL para onde o provedor redireciona o cliente de volta (a confirmação do pedido, Etapa 10). */
  backUrl: string;
  /** URL do endpoint de webhook desta etapa. */
  notificationUrl: string;
}

export interface CreatePaymentResult {
  /** Identificador do que foi criado no gateway (ex.: preference id do Mercado Pago) — não é necessariamente o id do pagamento final, que só existe depois que o cliente paga. */
  externalId: string;
  /** URL para onde redirecionar o cliente para efetivamente pagar. */
  checkoutUrl: string;
}

export type NormalizedPaymentStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "REFUNDED";

export interface PaymentDetails {
  externalId: string;
  status: NormalizedPaymentStatus;
  amount: number;
  method: string | null;
  /** O que o checkout gravou como `external_reference` ao criar o pagamento — sempre o `order_id` (arquitetura §12.1: nunca um tenant_id solto do payload). */
  externalReference: string | null;
}

export interface WebhookEvent {
  /** Chave de idempotência (arquitetura §12.1: `(provider, event_id)` único). */
  eventId: string;
  /** Identificador da conta do lojista no provedor — usado para resolver o tenant via `store_payment_providers`, nunca um tenant_id do payload. */
  providerAccountId: string | null;
  /** Id do pagamento no provedor, a ser consultado via `getPayment` para obter o estado real (nunca confiar só no payload do webhook). */
  paymentExternalId: string | null;
}

export interface PaymentGateway {
  readonly provider: PaymentProvider;
  getAuthorizeUrl(state: string, redirectUri: string): string;
  exchangeCodeForTokens(code: string, redirectUri: string): Promise<OAuthTokens>;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  getPayment(accessToken: string, externalId: string): Promise<PaymentDetails>;
  verifyWebhookSignature(headers: Headers, rawBody: string): boolean;
  parseWebhookEvent(headers: Headers, payload: unknown): WebhookEvent | null;
  refundPayment(accessToken: string, externalId: string): Promise<void>;
}
