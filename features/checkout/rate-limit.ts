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
 * LIMITAÇÃO CONHECIDA (Security Review D19.1.3.1 §D): isto protege 100%
 * do tráfego que passa pelo storefront/Server Action, mas NÃO fecha a
 * chamada direta e anônima à RPC via REST do Supabase —
 * create_order_from_cart é `anon`-callable por design (arquitetura
 * §5.3, checkout 100% anônimo) e permanece assim; não existe IP (nem
 * qualquer outro sinal de identidade do chamador HTTP) disponível
 * dentro de uma function PL/pgSQL para aplicar o mesmo limite ali
 * dentro sem: (a) usar `p_tenant_id`/`p_cart_id` como chave, que um
 * script contorna trivialmente gerando carrinhos novos, ou penaliza
 * TODOS os clientes reais de uma loja de uma vez; ou (b) uma mudança de
 * infraestrutura maior (ex.: um proxy/edge function na frente da API
 * REST do Supabase) — fora do escopo desta correção. Ver relatório
 * D19.1.3.1 para a análise completa.
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
