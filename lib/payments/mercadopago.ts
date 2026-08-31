import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  CreatePaymentInput,
  CreatePaymentResult,
  NormalizedPaymentStatus,
  OAuthTokens,
  PaymentDetails,
  PaymentGateway,
  WebhookEvent,
} from "./gateway";

/**
 * Implementação real para Mercado Pago (arquitetura Etapa 11 §2/§11) —
 * chamadas HTTP reais aos endpoints documentados publicamente pelo
 * Mercado Pago. IMPORTANTE (ver relatório final): não validado contra o
 * sandbox/produção real do Mercado Pago neste ambiente (sem
 * credenciais) — implementado com o cuidado possível a partir da
 * documentação pública, mas o formato exato de cada endpoint/header
 * (em especial a assinatura de webhook) deve ser reconferido contra a
 * documentação oficial atual antes de produção.
 */

const API_BASE = "https://api.mercadopago.com";
const AUTH_BASE = "https://auth.mercadopago.com";

// D9.1 — mesmo padrão de lib/billing/asaas.ts (AbortController + timeout
// fixo): nenhuma das 4 chamadas HTTP deste gateway tinha proteção contra
// o Mercado Pago ficar lento/indisponível, o que prenderia uma Server
// Action/callback/webhook até o limite da função serverless. 10s é o
// mesmo valor já usado no cliente do Asaas.
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Nunca inclui headers/body na mensagem de erro (só a URL, que aqui nunca
 * carrega token/segredo — client_id/access_token sempre vão em header ou
 * body, nunca na URL) — mesmo cuidado de `extractErrorDescription` em
 * lib/billing/asaas.ts: a mensagem de erro só descreve a falha de rede/
 * timeout em si, nunca ecoa nada da requisição.
 */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`mercadopago: request to ${url} timed out after ${DEFAULT_TIMEOUT_MS}ms`);
    }
    throw new Error(`mercadopago: network error calling ${url}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

function mapStatus(mpStatus: string): NormalizedPaymentStatus {
  switch (mpStatus) {
    case "approved":
      return "APPROVED";
    case "rejected":
      return "REJECTED";
    case "cancelled":
      return "CANCELLED";
    case "refunded":
    case "charged_back":
      return "REFUNDED";
    default:
      // pending, in_process, authorized, in_mediation, etc.
      return "PENDING";
  }
}

export function createMercadoPagoGateway(clientId: string, clientSecret: string, webhookSecret: string): PaymentGateway {
  return {
    provider: "mercadopago",

    getAuthorizeUrl(state, redirectUri) {
      const url = new URL(`${AUTH_BASE}/authorization`);
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("platform_id", "mp");
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("state", state);
      return url.toString();
    },

    async exchangeCodeForTokens(code, redirectUri) {
      const response = await fetchWithTimeout(`${API_BASE}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!response.ok) {
        throw new Error(`mercadopago: token exchange failed (${response.status})`);
      }
      const data = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
        user_id: number | string;
        expires_in?: number;
      };
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? null,
        providerAccountId: String(data.user_id),
        expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
      };
    },

    async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
      const response = await fetchWithTimeout(`${API_BASE}/checkout/preferences`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${input.accessToken}`,
        },
        body: JSON.stringify({
          items: [
            {
              title: `Pedido ${input.orderNumber}`,
              quantity: 1,
              unit_price: input.amount,
              currency_id: "BRL",
            },
          ],
          payer: { email: input.customerEmail },
          external_reference: input.orderId,
          back_urls: { success: input.backUrl, pending: input.backUrl, failure: input.backUrl },
          auto_return: "approved",
          notification_url: input.notificationUrl,
        }),
      });
      if (!response.ok) {
        throw new Error(`mercadopago: create preference failed (${response.status})`);
      }
      const data = (await response.json()) as { id: string; init_point: string };
      return { externalId: data.id, checkoutUrl: data.init_point };
    },

    async getPayment(accessToken, externalId) {
      const response = await fetchWithTimeout(`${API_BASE}/v1/payments/${encodeURIComponent(externalId)}`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        throw new Error(`mercadopago: get payment failed (${response.status})`);
      }
      const data = (await response.json()) as {
        id: number | string;
        status: string;
        transaction_amount: number;
        payment_method_id: string | null;
        external_reference: string | null;
      };
      return {
        externalId: String(data.id),
        status: mapStatus(data.status),
        amount: data.transaction_amount,
        method: data.payment_method_id,
        externalReference: data.external_reference,
      };
    },

    verifyWebhookSignature(headers, rawBody) {
      const signatureHeader = headers.get("x-signature");
      const requestId = headers.get("x-request-id");
      if (!signatureHeader || !requestId) return false;

      const parts = Object.fromEntries(
        signatureHeader.split(",").map((part) => {
          const [key, value] = part.split("=").map((s) => s.trim());
          return [key, value] as [string, string];
        }),
      );
      const ts = parts.ts;
      const v1 = parts.v1;
      if (!ts || !v1) return false;

      let dataId = "";
      try {
        const parsed = JSON.parse(rawBody) as { data?: { id?: string | number } };
        dataId = String(parsed.data?.id ?? "").toLowerCase();
      } catch {
        return false;
      }

      const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
      const expected = createHmac("sha256", webhookSecret).update(manifest).digest("hex");

      const expectedBuf = Buffer.from(expected);
      const receivedBuf = Buffer.from(v1);
      return expectedBuf.length === receivedBuf.length && timingSafeEqual(expectedBuf, receivedBuf);
    },

    parseWebhookEvent(headers, payload): WebhookEvent | null {
      if (typeof payload !== "object" || payload === null) return null;
      const body = payload as { id?: string | number; user_id?: string | number; data?: { id?: string | number } };
      const eventId = body.id !== undefined ? String(body.id) : headers.get("x-request-id");
      const paymentExternalId = body.data?.id !== undefined ? String(body.data.id) : null;
      if (!eventId || !paymentExternalId) return null;
      return {
        eventId,
        providerAccountId: body.user_id !== undefined ? String(body.user_id) : null,
        paymentExternalId,
      };
    },

    async refundPayment(accessToken, externalId) {
      const response = await fetchWithTimeout(`${API_BASE}/v1/payments/${encodeURIComponent(externalId)}/refunds`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        throw new Error(`mercadopago: refund failed (${response.status})`);
      }
    },
  };
}
