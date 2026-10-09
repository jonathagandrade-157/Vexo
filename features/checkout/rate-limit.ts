import "server-only";

import { headers } from "next/headers";

import { checkRateLimit, getClientIp } from "@/lib/security/rate-limit";

const CHECKOUT_WINDOW_SECONDS = 60;
const CHECKOUT_MAX_REQUESTS = 5;

/**
 * D19.1.3.1 (H1 — Security Review D19.1.3) — mesma infraestrutura de
 * rate limiting já usada em app/api/shipping/quote/route.ts
 * (lib/security/rate-limit.ts, migration 20260817220099), aplicada aqui
 * ao caminho REAL usado pelo storefront:
 * createOrderAction/createOrderForWhatsappAction → RPC
 * create_order_from_cart. 5 tentativas/60s por (IP, tenant) — generoso
 * para um cliente real que erra o formulário algumas vezes, apertado
 * para dificultar um script varrendo o estoque de um produto via
 * pedidos falsos não pagos.
 *
 * Fail-OPEN de propósito, diferente da cotação de frete (que é
 * fail-closed porque protege uma chamada externa PAGA — migration
 * 20260817220099/app/api/shipping/quote/route.ts): create_order_from_cart
 * não chama nenhuma API externa (o pagamento é iniciado depois, em
 * initiatePaymentForOrder, um passo separado) — bloquear TODO checkout
 * por uma indisponibilidade momentânea do limiter trocaria um risco de
 * abuso por uma perda de venda real garantida, um trade-off pior aqui.
 *
 * Etapa 2A: as RPCs de criação de pedido deixaram de ser chamáveis por
 * anon e todo checkout passa pelo BFF com validação de posse. O IP segue
 * disponível somente nesta camada, por isso o rate limit permanece aqui
 * como proteção contra abuso, adicional à autorização criptográfica.
 */
export async function checkCheckoutRateLimit(tenantId: string): Promise<{ limited: false } | { limited: true; message: string }> {
  const headersList = await headers();
  const ip = getClientIp(headersList) ?? "unknown";
  const rateLimit = await checkRateLimit(`checkout:${ip}:${tenantId}`, CHECKOUT_WINDOW_SECONDS, CHECKOUT_MAX_REQUESTS);

  if (!rateLimit || rateLimit.allowed) return { limited: false };
  return {
    limited: true,
    message: "Muitas tentativas de finalizar pedido em pouco tempo. Aguarde um instante e tente novamente.",
  };
}
