import { NextResponse, type NextRequest } from "next/server";

import { getCartId } from "@/features/cart/cart-cookie";
import { getShippingQuote } from "@/features/shipping/quote";
import { resolveStorefrontTenant } from "@/features/storefront/resolve-tenant";
import { checkRateLimit, getClientIp, rateLimitedResponse } from "@/lib/security/rate-limit";

/**
 * D15-S.2 — 10 requisições/60s por (IP, tenant): generoso o bastante para
 * um cliente real trocar de CEP algumas vezes durante o checkout, apertado
 * o bastante para barrar abuso automatizado. Chave inclui o tenant (nunca
 * só o IP) para que abuso contra UMA loja não derrube a cotação de frete
 * de outras lojas compartilhando o mesmo IP (NAT/rede corporativa) — ver
 * lib/security/rate-limit.ts para o porquê de ser via Postgres, não em
 * memória.
 */
const SHIPPING_QUOTE_WINDOW_SECONDS = 60;
const SHIPPING_QUOTE_MAX_REQUESTS = 10;

/**
 * Único endpoint externo do cálculo de frete (prompt §16: "cálculo de
 * frete no checkout") — chamado pelo formulário de checkout via fetch
 * quando o CEP é preenchido, sempre com o `slug` da própria URL (nunca um
 * tenant_id solto do cliente), mesmo modelo de resolução de
 * `resolveStorefrontTenant` já usado no resto do storefront (Etapa 6).
 * GET (não Server Action): é uma leitura idempotente, chamada por
 * JavaScript client-side de um Client Component, não de um `<form>`.
 *
 * D3.2-B Ponto 2D — `cartId` vem do MESMO cookie httpOnly que
 * `features/cart/*` já usa (`getCartId`, nunca aceito de query/body),
 * necessário para o provedor Melhor Envio montar `products[]` a partir
 * do carrinho real. `flat_rate` ignora esse valor (preço fixo).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug");
  const zipRaw = searchParams.get("zip");

  if (!slug || !zipRaw) {
    return NextResponse.json({ status: "invalid_zip" }, { status: 400 });
  }

  const zip = zipRaw.replace(/\D/g, "");
  if (zip.length !== 8) {
    return NextResponse.json({ status: "invalid_zip" });
  }

  const resolution = await resolveStorefrontTenant(slug);
  if (resolution.status !== "ready") {
    return NextResponse.json({ status: "unavailable" });
  }

  // D15-S.2 — sempre ANTES de qualquer chamada externa ao Melhor Envio
  // (dentro de getShippingQuote abaixo). Fail-CLOSED de propósito: se o
  // limiter estiver indisponível (erro ao falar com o Postgres), rejeita
  // em vez de seguir para a chamada externa — permitir a chamada paga
  // justamente quando não dá para verificar o limite seria o próprio
  // vetor de abuso que este endpoint precisa fechar. O trade-off aceito é
  // que `flat_rate` (cálculo local, sem custo externo) também fica
  // indisponível nesse cenário raro — nunca vale a pena separar os dois
  // caminhos só por causa disso.
  const ip = getClientIp(request) ?? "unknown";
  const rateLimitKey = `shipping-quote:${ip}:${resolution.tenant.id}`;
  const rateLimit = await checkRateLimit(rateLimitKey, SHIPPING_QUOTE_WINDOW_SECONDS, SHIPPING_QUOTE_MAX_REQUESTS);
  if (!rateLimit) {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit.retryAfterSeconds);
  }

  const cartId = await getCartId(slug);
  const quote = await getShippingQuote(resolution.tenant.id, zip, cartId);
  return NextResponse.json(quote);
}
