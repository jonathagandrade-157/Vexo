import "server-only";

/**
 * Abstração de conexão OAuth com um provedor de frete (D3.2-B — mesmo
 * desenho de lib/payments/gateway.ts, Etapa 11). Escopo estritamente
 * limitado a "conectar/desconectar a conta" — nenhum método de cotação,
 * etiqueta, rastreio ou compra existe aqui de propósito (fora do escopo
 * desta etapa; ver auditoria D3.2 Ponto 1). Só Melhor Envio é
 * implementado (`melhorenvio.ts`); um segundo provedor de frete entra
 * depois só adicionando um novo arquivo + um `case` em `registry.ts`.
 */

export type ShippingConnectionProvider = "melhor_envio";

export interface ShippingOAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  /** access_token do Melhor Envio: válido por 30 dias (confirmado em docs.melhorenvio.com.br). */
  expiresAt: Date | null;
  /** refresh_token do Melhor Envio: válido por 45 dias (idem) — campo que não existe no gateway de pagamentos (Mercado Pago só tem um prazo). */
  refreshExpiresAt: Date | null;
}

export interface ShippingConnectionGateway {
  readonly provider: ShippingConnectionProvider;
  getAuthorizeUrl(state: string, redirectUri: string): string;
  exchangeCodeForTokens(code: string, redirectUri: string): Promise<ShippingOAuthTokens>;
  /**
   * D3.2-B Ponto 1B — troca um `refresh_token` por um novo `access_token`
   * (grant_type=refresh_token, RFC 6749 §6). Nunca recebe `redirectUri`:
   * esse parâmetro é específico do grant `authorization_code`, não do de
   * refresh. Lança `ShippingRefreshError` classificado (nunca um `Error`
   * genérico) para quem chama decidir se o erro é transitório ou exige
   * reconexão do tenant.
   */
  refreshAccessToken(refreshToken: string): Promise<ShippingOAuthTokens>;
}

/** Mesmo desenho de lib/billing/gateway.ts (`BillingErrorCode`/`BillingGatewayError`) — nunca um `Error` genérico para falha de rede/API. */
export type ShippingRefreshErrorCode =
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  /** invalid_grant (RFC 6749 §5.2) — refresh_token revogado/inválido/expirado. Único código que deve resultar em marcar o tenant como precisando reconectar. */
  | "INVALID_REFRESH_TOKEN"
  /** invalid_client (RFC 6749 §5.2) — client_id/client_secret do VEXO errados: problema de configuração global, nunca do tenant. Nunca deve desconectar um tenant. */
  | "INVALID_CLIENT"
  | "UNKNOWN";

export class ShippingRefreshError extends Error {
  readonly provider: ShippingConnectionProvider;
  readonly status: number | null;
  readonly code: ShippingRefreshErrorCode;
  readonly retryable: boolean;

  constructor(params: { provider: ShippingConnectionProvider; status: number | null; code: ShippingRefreshErrorCode; message: string; retryable: boolean }) {
    super(params.message);
    this.name = "ShippingRefreshError";
    this.provider = params.provider;
    this.status = params.status;
    this.code = params.code;
    this.retryable = params.retryable;
  }
}
