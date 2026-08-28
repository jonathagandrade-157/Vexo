import "server-only";

import { ShippingRefreshError, type ShippingConnectionGateway, type ShippingOAuthTokens, type ShippingRefreshErrorCode } from "./gateway";

/**
 * Implementação real para Melhor Envio (D3.2-B Ponto 1 + Ponto 1B —
 * renovação de token). IMPORTANTE — ver relatório final de cada etapa.
 *
 * CONFIRMADO por FONTE PRIMÁRIA OFICIAL (D3.2-B Ponto 1B — auditoria de
 * produção): `github.com/melhorenvio/auth-sdk-php` — SDK PHP publicado
 * pela própria Melhor Envio (`composer.json`: `"authors": [{"name":
 * "Melhor Envio", "email": "tecnologia@melhorenvio.com"}]`), lido
 * diretamente via `git clone` (docs.melhorenvio.com.br continua
 * inacessível por fetch direto neste ambiente — rede bloqueada — mas o
 * código-fonte oficial do SDK não é bloqueado e é uma fonte primária pelo
 * menos tão autoritativa quanto a documentação em si, já que É o cliente
 * de referência da própria empresa). Confirmado literalmente em
 * `src/OAuth2.php`:
 *   - Base de produção: `https://melhorenvio.com.br` (idêntica à já usada aqui).
 *   - Base de sandbox: `https://sandbox.melhorenvio.com.br` (idêntica à já usada aqui).
 *   - Path de autorização: `/oauth/authorize` (idêntico ao já usado aqui).
 *   - Path de token: `/oauth/token`, o MESMO para `authorization_code` e
 *     `refresh_token` (grant_type muda, path não) — idêntico ao já usado aqui.
 *   - Body do refresh: `grant_type=refresh_token`, `client_id`,
 *     `client_secret`, `refresh_token` — NUNCA `redirect_uri` (RFC 6749
 *     §6) — confirma a implementação já existente.
 *   - **Content-Type do POST a `/oauth/token`: `application/x-www-form-urlencoded`
 *     (confirmado por teste unitário oficial do SDK,
 *     `it_issues_an_access_token_with_the_APPLICATION_X_WWW_FORM_URLENCODED_header`),
 *     NUNCA `application/json`.** Esta implementação enviava
 *     `application/json` até esta auditoria — corrigido para
 *     `application/x-www-form-urlencoded` (ver `postToken()` abaixo).
 *   - Lista de scopes reconfirmada literalmente em `examples/example3.php`
 *     (cart-read/write, companies-read/write, coupons-read/write,
 *     notifications-read, orders-read, products-read/write,
 *     purchases-read, shipping-calculate/cancel/checkout/companies/
 *     generate/preview/print/share/tracking, ecommerce-shipping,
 *     transactions-read, users-read/write) — nenhum é enviado nesta
 *     etapa (ver disclaimer de escopo abaixo).
 *
 * Também confirmado (pesquisa anterior, D3.2-B Ponto 1): protocolo OAuth
 * 2.0; access_token válido por 30 dias; refresh_token válido por 45 dias;
 * rate limit de 250 requisições/minuto por usuário autenticado.
 *
 * NÃO CONFIRMADO: os códigos de erro exatos (`invalid_grant`/
 * `invalid_client`) usados na classificação abaixo seguem o padrão OAuth2
 * (RFC 6749 §5.2), mas o SDK oficial não filtra por esses códigos — só
 * repassa o corpo bruto da resposta como mensagem de exceção — então essa
 * classificação especificamente ainda não tem uma citação literal da
 * Melhor Envio a favor (risco residual, menor que o de Content-Type
 * corrigido acima). `User-Agent`: o SDK oficial não define nenhum
 * (usa o Guzzle padrão) nas chamadas OAuth — consistente com (mas não
 * prova) a exceção às rotas OAuth2 mencionada em pesquisa anterior;
 * enviado aqui mesmo assim por precaução (nunca é proibido, só talvez
 * desnecessário). Segue o mesmo padrão hardcoded (sem e-mail — nenhum
 * contato de suporte da VEXO está declarado em nenhum lugar do código;
 * inventar um violaria "não presumir dados") já usado em
 * lib/billing/asaas.ts (`"VEXO-Billing/1.0"`). NUNCA contém
 * access_token/refresh_token/client_secret/tenant_id/dado de cliente.
 *
 * D3.2-B Ponto 2B — a URL de autorização passa a solicitar explicitamente
 * o scope `shipping-calculate` (o único necessário para a futura cotação,
 * Ponto 2C — nenhuma chamada de cotação acontece nesta etapa). Nome do
 * scope confirmado literalmente na mesma fonte primária oficial citada
 * acima (`auth-sdk-php/examples/example3.php`: `'shipping-calculate'` na
 * lista de scopes do SDK). Nenhum outro scope da lista (`shipping-cancel`,
 * `shipping-checkout`, `shipping-companies`, `shipping-generate`,
 * `shipping-preview`, `shipping-print`, `shipping-share`,
 * `shipping-tracking`, `ecommerce-shipping`, ou qualquer um dos scopes de
 * `cart`/`companies`/`coupons`/`notifications`/`orders`/`products`/
 * `purchases`/`transactions`/`users`) é solicitado — só o estritamente
 * necessário para cotar frete.
 *
 * Contas já conectadas ANTES desta mudança tiveram seu token emitido sem
 * nenhum scope — este código nunca presume que um token antigo já tem
 * `shipping-calculate` (nenhuma chamada a um endpoint de "verificar
 * scopes" é feita). Uma conta assim só passa a ter o scope após o
 * lojista reconectar (desconectar + `connectMelhorEnvioAction` de novo),
 * o que gera um novo consentimento/token através deste mesmo
 * `getAuthorizeUrl` já atualizado — sem nenhuma migration ou mudança de
 * schema necessária: `store_shipping_credentials` (migration 087) já faz
 * upsert por `(tenant_id, provider)` e já limpa o segredo antigo do Vault
 * na reconexão, então o fluxo de reconexão já era idempotente antes desta
 * mudança.
 */

const SANDBOX_BASE = "https://sandbox.melhorenvio.com.br";
// Não confirmado por fetch direto da documentação (ver disclaimer acima) — mesma convenção de path do sandbox, subdomínio de produção.
const PRODUCTION_BASE = "https://melhorenvio.com.br";

const REFRESH_TOKEN_TTL_MS = 45 * 24 * 60 * 60 * 1000; // 45 dias (confirmado)

const USER_AGENT = "VEXO-ShippingIntegration/1.0";
const TOKEN_REQUEST_TIMEOUT_MS = 10_000; // mesmo valor default de lib/billing/asaas.ts

interface TokenResponseBody {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

interface OAuthErrorBody {
  error?: string;
  error_description?: string;
}

function mapTokensFromResponse(data: TokenResponseBody): ShippingOAuthTokens {
  const now = Date.now();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: data.expires_in ? new Date(now + data.expires_in * 1000) : null,
    // O endpoint de token não expõe uma data de expiração separada para o
    // refresh_token (só `expires_in`, do access_token, padrão OAuth2) —
    // derivada aqui a partir do prazo de 45 dias confirmado na
    // documentação, contado a partir do momento da troca/renovação.
    refreshExpiresAt: data.refresh_token ? new Date(now + REFRESH_TOKEN_TTL_MS) : null,
  };
}

function classifyStatus(status: number, errorBody: OAuthErrorBody | null): ShippingRefreshErrorCode {
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVER_ERROR";
  if (status === 400 || status === 401) {
    // RFC 6749 §5.2 — corpo padrão OAuth2 `{ error, error_description }`.
    // invalid_grant cobre tanto "inválido" quanto "expirado" (o protocolo
    // não distingue os dois na resposta); invalid_client é sempre sobre a
    // credencial DO VEXO (client_id/client_secret), nunca do tenant.
    if (errorBody?.error === "invalid_grant") return "INVALID_REFRESH_TOKEN";
    if (errorBody?.error === "invalid_client") return "INVALID_CLIENT";
  }
  return "UNKNOWN";
}

/**
 * POST compartilhado ao endpoint de token — usado tanto para a troca
 * inicial (`authorization_code`) quanto para a renovação
 * (`refresh_token`). Único ponto que sabe montar o header `User-Agent` e
 * classificar erros de rede/timeout/HTTP — nunca duplicado entre
 * `exchangeCodeForTokens`/`refreshAccessToken`.
 */
async function postToken(base: string, body: Record<string, string>, timeoutMs: number): Promise<ShippingOAuthTokens> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${base}/oauth/token`, {
      method: "POST",
      // application/x-www-form-urlencoded — confirmado por fonte
      // primária oficial (github.com/melhorenvio/auth-sdk-php, ver
      // comentário no topo do arquivo); NUNCA application/json aqui.
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "user-agent": USER_AGENT },
      body: new URLSearchParams(body).toString(),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw new ShippingRefreshError({
        provider: "melhor_envio",
        status: null,
        code: "TIMEOUT",
        message: `melhorenvio: token request timed out after ${timeoutMs}ms`,
        retryable: true,
      });
    }
    throw new ShippingRefreshError({
      provider: "melhor_envio",
      status: null,
      code: "NETWORK_ERROR",
      message: "melhorenvio: network error calling /oauth/token",
      retryable: true,
    });
  }
  clearTimeout(timeoutId);

  const raw = await response.text();
  let data: unknown = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new ShippingRefreshError({
        provider: "melhor_envio",
        status: response.status,
        code: "INVALID_RESPONSE",
        message: "melhorenvio: malformed (non-JSON) response body from /oauth/token",
        retryable: response.status >= 500,
      });
    }
  }

  if (!response.ok) {
    const errorBody = data && typeof data === "object" ? (data as OAuthErrorBody) : null;
    const code = classifyStatus(response.status, errorBody);
    throw new ShippingRefreshError({
      provider: "melhor_envio",
      status: response.status,
      code,
      message: `melhorenvio: token request failed (${response.status})${errorBody?.error ? `: ${errorBody.error}` : ""}`,
      retryable: code === "RATE_LIMITED" || code === "SERVER_ERROR",
    });
  }

  if (!data || typeof data !== "object" || typeof (data as TokenResponseBody).access_token !== "string") {
    throw new ShippingRefreshError({
      provider: "melhor_envio",
      status: response.status,
      code: "INVALID_RESPONSE",
      message: "melhorenvio: token response missing access_token",
      retryable: false,
    });
  }

  return mapTokensFromResponse(data as TokenResponseBody);
}

export function createMelhorEnvioGateway(
  clientId: string,
  clientSecret: string,
  sandbox: boolean,
  timeoutMs = TOKEN_REQUEST_TIMEOUT_MS,
): ShippingConnectionGateway {
  const base = sandbox ? SANDBOX_BASE : PRODUCTION_BASE;

  return {
    provider: "melhor_envio",

    getAuthorizeUrl(state, redirectUri) {
      const url = new URL(`${base}/oauth/authorize`);
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("state", state);
      // D3.2-B Ponto 2B — único scope solicitado, necessário para a
      // futura cotação (Ponto 2C). Nunca client_secret/access_token/
      // refresh_token nesta URL — só parâmetros públicos do grant
      // authorization_code (RFC 6749 §4.1.1).
      url.searchParams.set("scope", "shipping-calculate");
      return url.toString();
    },

    async exchangeCodeForTokens(code, redirectUri): Promise<ShippingOAuthTokens> {
      return postToken(
        base,
        {
          grant_type: "authorization_code",
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          code,
        },
        timeoutMs,
      );
    },

    async refreshAccessToken(refreshToken): Promise<ShippingOAuthTokens> {
      // Nunca inclui `redirect_uri` — RFC 6749 §6, o grant refresh_token
      // não usa esse parâmetro.
      return postToken(
        base,
        {
          grant_type: "refresh_token",
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
        },
        timeoutMs,
      );
    },
  };
}
