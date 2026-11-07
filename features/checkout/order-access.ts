import "server-only";

import { getServerEnv } from "@/lib/env";
import {
  createOrderAccessToken,
  deriveOrderAccessKey,
  ORDER_ACCESS_QUERY_PARAM,
  verifyOrderAccessToken,
  type OrderAccessVerification,
} from "@/lib/security/order-access-token";

function orderAccessKey(): Buffer {
  const env = getServerEnv();
  return deriveOrderAccessKey(env.ORDER_ACCESS_SECRET ?? env.TRIAL_HASH_SECRET);
}

/**
 * Único construtor do link da confirmação de pedido. Todo redirect pós-
 * checkout, `back_url` do gateway e e-mail transacional passa por aqui, de
 * modo que o link legítimo sempre carrega a prova assinada; a URL sem ela
 * deixa de revelar o pedido.
 */
export function orderConfirmationPath(storeSlug: string, tenantId: string, orderId: string): string {
  const token = createOrderAccessToken({ key: orderAccessKey(), tenantId, orderId });
  return `/loja/${encodeURIComponent(storeSlug)}/pedido/${encodeURIComponent(orderId)}?${ORDER_ACCESS_QUERY_PARAM}=${encodeURIComponent(token)}`;
}

export function verifyOrderAccess(tenantId: string, orderId: string, token: string | string[] | undefined): OrderAccessVerification {
  if (Array.isArray(token)) return "invalid";
  return verifyOrderAccessToken({ key: orderAccessKey(), tenantId, orderId, token });
}
