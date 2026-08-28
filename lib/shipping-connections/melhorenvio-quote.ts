import "server-only";

import { getMelhorEnvioEnv } from "@/lib/env";
import { ensureFreshMelhorEnvioToken } from "./refresh";

/**
 * D3.2-B Ponto 2C — cliente de cotação do Melhor Envio
 * (`POST /api/v2/me/shipment/calculate`). Escopo estritamente "chamar a
 * API e devolver uma estrutura interna limpa" — nenhuma integração com
 * `lib/shipping/provider.ts`/`registry.ts`, checkout, UI ou
 * `apply_shipping_to_order` acontece aqui (ver Ponto 2D, futuro).
 *
 * Endpoint/payload/resposta CONFIRMADOS por fonte primária oficial na
 * auditoria D3.2-B Ponto 2 (`github.com/melhorenvio/shipment-sdk-php`,
 * SDK publicado pela própria Melhor Envio — `composer.json`: `"authors":
 * [{"name": "Melhor Envio", ...}]`):
 *   - Path: `me/shipment/calculate` (POST), confirmado literalmente em
 *     `Calculator.php::calculate()` e reconfirmado por teste unitário
 *     oficial do SDK.
 *   - Base + versão: `{ENDPOINTS[env]}/api/{VERSIONS[env]}/` —
 *     `Enums/Endpoint.php` confirma `v2` e as mesmas duas bases já usadas
 *     em `melhorenvio.ts` (OAuth).
 *   - Autenticação: header `Authorization: Bearer {token}` (nunca
 *     query param) — `Resources/Base.php`.
 *   - Payload: `{from:{postal_code}, to:{postal_code}, products:[{id,
 *     height, width, length, weight, insurance_value, quantity}],
 *     services: "1,2,3"}` — dimensões em cm, peso em kg (README oficial).
 *     `volumes` (pacotes pré-montados) existe como alternativa mas não é
 *     usado nesta etapa (prompt Ponto 2C §4/§10).
 *   - Resposta: array de opções `{id, name, price (string), delivery_time
 *     (int), company:{...}, ...}` — fixture literal do teste unitário
 *     oficial do SDK.
 *
 * `services`: o VEXO não possui NENHUMA configuração de
 * transportadoras/serviços (confirmado por auditoria — nenhum campo em
 * `shipping_settings`/`shipping_methods` ou em qualquer outro lugar).
 * Por isso é um parâmetro OBRIGATÓRIO desta função (nunca uma lista
 * arbitrária tipo "1,2,3" inventada aqui) — decidir QUAIS serviços
 * oferecer é uma decisão de produto para uma etapa futura (Ponto 2D ou
 * posterior), fora do escopo deste cliente.
 *
 * `originZip`: o VEXO tem DUAS fontes candidatas para o CEP de origem
 * (`shipping_settings.origin_zip`, reservado desde a Etapa 12
 * explicitamente "como base para uma integração futura", vs.
 * `tenants.address_zip`, o endereço completo da loja) — auditoria D3.2-B
 * Ponto 2 já registrou essa ambiguidade como decisão pendente, não
 * decidida aqui por conveniência. Por isso `originZip` é um parâmetro
 * explícito desta função (já resolvido/normalizado por quem chama) — a
 * escolha de QUAL coluna alimenta esse parâmetro fica para a integração
 * futura (Ponto 2D).
 */

const SANDBOX_BASE = "https://sandbox.melhorenvio.com.br";
const PRODUCTION_BASE = "https://melhorenvio.com.br";
const API_VERSION = "v2";

// Mesmo User-Agent/timeout já usados para o fluxo OAuth (melhorenvio.ts)
// — mesma app, mesma convenção, nenhum dado sensível.
const USER_AGENT = "VEXO-ShippingIntegration/1.0";
const QUOTE_REQUEST_TIMEOUT_MS = 10_000;

export interface ShipmentQuoteProduct {
  /** Identificador enviado à API — sempre products.id (uuid) convertido para string. */
  id: string;
  /** Centímetros. */
  height: number;
  /** Centímetros. */
  width: number;
  /** Centímetros. */
  length: number;
  /** Quilogramas. */
  weight: number;
  /** Reais — sempre o preço efetivo do produto (promotional_price ?? price), nunca um valor vindo do navegador. */
  insuranceValue: number;
  quantity: number;
}

export interface ShipmentQuoteOption {
  provider: "melhor_envio";
  serviceId: string;
  name: string;
  price: number;
  deliveryTime: number;
  currency: "BRL";
}

export type ShipmentQuoteUnavailableReason =
  /** Tenant nunca conectou o Melhor Envio. */
  | "not_connected"
  /** Refresh_token confirmadamente inválido/expirado (ensureFreshMelhorEnvioToken já determinou isso — este módulo nunca toma essa decisão sozinho). */
  | "needs_reconnection"
  /** Falha transitória (timeout, rede, 429, 5xx, refresh temporariamente indisponível) — tentar de novo mais tarde pode funcionar. */
  | "temporarily_unavailable"
  /** Resposta inesperada da API (4xx não classificado, corpo malformado, resposta que não é um array). */
  | "upstream_error";

export type ShipmentQuoteResult =
  | { status: "ok"; options: ShipmentQuoteOption[] }
  | { status: "unavailable"; reason: ShipmentQuoteUnavailableReason };

export interface CalculateShipmentQuoteParams {
  tenantId: string;
  /** CEP de origem já resolvido por quem chama (ver disclaimer no topo do arquivo) — validado/normalizado de novo aqui, defensivamente. */
  originZip: string;
  destinationZip: string;
  products: ShipmentQuoteProduct[];
  /** IDs numéricos de serviço da Melhor Envio (Enums/Service.php do SDK oficial) — obrigatório, nunca inventado aqui. */
  services: number[];
  /** Só para teste (mesmo padrão de `createMelhorEnvioGateway`, melhorenvio.ts) — nunca passado em produção. */
  timeoutMs?: number;
}

/** Só dígitos, exatamente 8 — nunca aceita CEP mascarado/incompleto, mesmo já validado por quem chama (defesa em profundidade). */
function normalizePostalCode(raw: string, label: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 8) {
    throw new Error(`calculateShipmentQuote: ${label} must be exactly 8 digits`);
  }
  return digits;
}

/**
 * "27.48" → 27.48. Nunca `Number(str)` direto (aceitaria notação
 * científica, vírgula decimal dependendo do ambiente, etc.) — regex
 * estrito primeiro, só então converte. Retorna `null` para qualquer
 * valor que não seja uma string decimal não-negativa bem formada
 * (NaN/Infinity/negativo/vírgula/vazio) — a opção correspondente é
 * descartada por quem chama, nunca "corrigida" ou arredondada aqui.
 */
function parseUpstreamPrice(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

function parseDeliveryTime(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) return null;
  return raw;
}

/** Valida os 4 campos essenciais (id/name/price/delivery_time) antes de aceitar uma opção — nunca confia cegamente na resposta externa. Descarta (retorna null) qualquer entrada malformada, em vez de lançar. */
function parseQuoteOption(entry: unknown): ShipmentQuoteOption | null {
  if (!entry || typeof entry !== "object") return null;
  const raw = entry as Record<string, unknown>;

  if (typeof raw.id !== "number" && typeof raw.id !== "string") return null;
  if (typeof raw.name !== "string" || raw.name.trim().length === 0) return null;

  const price = parseUpstreamPrice(raw.price);
  if (price === null) return null;

  const deliveryTime = parseDeliveryTime(raw.delivery_time);
  if (deliveryTime === null) return null;

  return {
    provider: "melhor_envio",
    serviceId: String(raw.id),
    name: raw.name,
    price,
    // A API pode retornar "R$" — o modelo interno do VEXO usa sempre o
    // código de moeda ISO, nunca o símbolo enviado pelo provedor.
    currency: "BRL",
    deliveryTime,
  };
}

/**
 * Ponto único que chama `POST /me/shipment/calculate`. Nunca chamado
 * pelo checkout/UI nesta etapa (Ponto 2C) — só testado isoladamente.
 * Sempre usa `ensureFreshMelhorEnvioToken` (nunca `getShippingCredentials`
 * diretamente) para nunca operar com um token perto de expirar; nunca usa
 * `refresh_token`/`client_secret` aqui (esses só existem dentro do fluxo
 * de refresh, em `melhorenvio.ts`/`refresh.ts`, não tocado por este
 * arquivo).
 */
export async function calculateShipmentQuote(params: CalculateShipmentQuoteParams): Promise<ShipmentQuoteResult> {
  const { tenantId, products, services, timeoutMs = QUOTE_REQUEST_TIMEOUT_MS } = params;

  if (services.length === 0) {
    throw new Error("calculateShipmentQuote: services must not be empty (no arbitrary default is invented here)");
  }

  const originZip = normalizePostalCode(params.originZip, "originZip");
  const destinationZip = normalizePostalCode(params.destinationZip, "destinationZip");

  const tokenResult = await ensureFreshMelhorEnvioToken(tenantId);
  if (tokenResult.status === "not_connected") return { status: "unavailable", reason: "not_connected" };
  if (tokenResult.status === "needs_reconnection") return { status: "unavailable", reason: "needs_reconnection" };
  if (!tokenResult.accessToken) {
    // Defensivo — na prática só acontece hoje com refresh_failed_temporary
    // sem nenhuma credencial previamente armazenada (ver refresh.ts).
    return { status: "unavailable", reason: tokenResult.status === "refresh_failed_temporary" ? "temporarily_unavailable" : "not_connected" };
  }

  const { MELHOR_ENVIO_SANDBOX } = getMelhorEnvioEnv();
  const base = MELHOR_ENVIO_SANDBOX ? SANDBOX_BASE : PRODUCTION_BASE;
  const url = `${base}/api/${API_VERSION}/me/shipment/calculate`;

  const payload = {
    from: { postal_code: originZip },
    to: { postal_code: destinationZip },
    products: products.map((p) => ({
      id: p.id,
      height: p.height,
      width: p.width,
      length: p.length,
      weight: p.weight,
      insurance_value: p.insuranceValue,
      quantity: p.quantity,
    })),
    services: services.join(","),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokenResult.accessToken}`,
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": USER_AGENT,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err instanceof Error && err.name === "AbortError";
    // Log mínimo: nunca token/payload/CEP. Nunca desconecta o tenant por
    // causa de uma falha de rede/timeout na COTAÇÃO — só o mecanismo de
    // refresh (INVALID_REFRESH_TOKEN) decide reconexão.
    console.error("[shipping-connections] melhor_envio shipment quote failed", {
      tenantId,
      status: null,
      code: isTimeout ? "TIMEOUT" : "NETWORK_ERROR",
      durationMs: Date.now() - startedAt,
    });
    return { status: "unavailable", reason: "temporarily_unavailable" };
  }
  clearTimeout(timeoutId);
  const durationMs = Date.now() - startedAt;

  if (!response.ok) {
    console.error("[shipping-connections] melhor_envio shipment quote failed", {
      tenantId,
      status: response.status,
      code: "HTTP_ERROR",
      durationMs,
    });
    // 429/5xx: indisponibilidade transitória. Qualquer outro 4xx
    // (incluindo 401/403): erro de upstream — nunca inferimos
    // "precisa reconectar" a partir disso (só o fluxo de refresh decide).
    if (response.status === 429 || response.status >= 500) {
      return { status: "unavailable", reason: "temporarily_unavailable" };
    }
    return { status: "unavailable", reason: "upstream_error" };
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    console.error("[shipping-connections] melhor_envio shipment quote failed", {
      tenantId,
      status: response.status,
      code: "INVALID_RESPONSE",
      durationMs,
    });
    return { status: "unavailable", reason: "upstream_error" };
  }

  if (!Array.isArray(raw)) {
    console.error("[shipping-connections] melhor_envio shipment quote failed", {
      tenantId,
      status: response.status,
      code: "INVALID_RESPONSE_SHAPE",
      durationMs,
    });
    return { status: "unavailable", reason: "upstream_error" };
  }

  // Cada entrada é validada individualmente e descartada se malformada —
  // uma resposta com algumas opções ruins ainda devolve as boas
  // (nunca falha tudo por causa de uma opção mal formada).
  const options = raw.map(parseQuoteOption).filter((option): option is ShipmentQuoteOption => option !== null);
  return { status: "ok", options };
}
