import { NextResponse, type NextRequest } from "next/server";

import { getCartId } from "@/features/cart/cart-cookie";
import { getShippingQuote } from "@/features/shipping/quote";
import { resolveStorefrontTenant } from "@/features/storefront/resolve-tenant";

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

  const cartId = await getCartId(slug);
  const quote = await getShippingQuote(resolution.tenant.id, zip, cartId);
  return NextResponse.json(quote);
}
