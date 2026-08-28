import "server-only";

import { buildMelhorEnvioProductsFromCart } from "@/features/shipping/melhor-envio-cart-products";
import { calculateShipmentQuote } from "@/lib/shipping-connections/melhorenvio-quote";
import { createSupabasePublicClient } from "@/lib/supabase/server";
import type { ShippingProvider, ShippingQuoteResult } from "./provider";

/**
 * D3.2-B Ponto 2D — provedor `ShippingProvider` real para o Melhor Envio.
 * Nunca duplica autenticação/HTTP (reaproveita
 * `lib/shipping-connections/melhorenvio-quote.ts::calculateShipmentQuote`,
 * que por sua vez usa `ensureFreshMelhorEnvioToken`) nem a leitura de
 * carrinho (reaproveita
 * `features/shipping/melhor-envio-cart-products.ts::buildMelhorEnvioProductsFromCart`,
 * Ponto 2C). Este arquivo só orquestra: resolve o CEP de origem, monta
 * `products[]`, chama a cotação, mapeia a resposta para `ShippingQuoteOption`
 * — nunca chama a API do Melhor Envio diretamente.
 */

/**
 * D3.2-B — decisão sobre CEP de origem: `shipping_settings.origin_zip`
 * (não `tenants.address_zip`). Motivo (decisão já tomada para este
 * ponto, não reavaliada aqui): o campo foi criado na Etapa 12
 * explicitamente "como base para uma futura integração de frete"; a API
 * do Melhor Envio exige só CEP na origem (nunca o endereço completo); e
 * evita acoplar a cotação ao endereço completo da loja. Nenhuma
 * sincronização entre os dois campos é criada nesta etapa.
 *
 * Lido via o mesmo client `anon` que `flat-rate.ts` já usa para
 * `shipping_settings` — como consequência direta (não inventada aqui) da
 * RLS já existente (migration 046, "anon can view enabled shipping
 * settings..."), `origin_zip` só é visível quando
 * `shipping_settings.enabled = true`: se o lojista não ligou a entrega,
 * Melhor Envio fica indisponível junto com `flat_rate` — mesmo
 * comportamento mestre já aplicado à outra modalidade, não um caso
 * especial nosso.
 */
async function getOriginZip(tenantId: string): Promise<string | null> {
  const supabase = createSupabasePublicClient();
  const { data } = await supabase.from("shipping_settings").select("enabled, origin_zip").eq("tenant_id", tenantId).maybeSingle();

  if (!data?.enabled || !data.origin_zip) return null;
  return data.origin_zip;
}

/**
 * D3.2-B Ponto 2D — o VEXO não possui NENHUMA configuração de
 * transportadoras/serviços (confirmado por auditoria — Ponto 2/2C). Este
 * é o conjunto mínimo INDISPENSÁVEL para o provider conseguir chamar a
 * API (`services` é obrigatório em `calculateShipmentQuote`), não uma
 * decisão de produto sobre quais serviços oferecer ao lojista — só os
 * Correios PAC (1) e SEDEX (2) (`Enums/Service.php` do SDK oficial,
 * confirmado no Ponto 2), os dois únicos serviços universalmente
 * disponíveis em qualquer conta do Melhor Envio, sem exigir contrato
 * adicional com uma transportadora específica (Jadlog/Via Brasil/Azul
 * Cargo/LATAM Cargo exigem habilitação própria na conta do lojista).
 * Uma configuração real (por tenant, no painel) é trabalho futuro, fora
 * do escopo deste ponto — nunca decidida aqui como definitiva.
 */
const DEFAULT_MELHOR_ENVIO_SERVICES = [1, 2];

export function createMelhorEnvioProvider(): ShippingProvider {
  return {
    type: "melhor_envio",

    async getQuote(tenantId, destinationZip, cartId): Promise<ShippingQuoteResult> {
      if (!cartId) return { status: "unavailable" };

      const originZip = await getOriginZip(tenantId);
      if (!originZip) return { status: "unavailable" };

      const productsResult = await buildMelhorEnvioProductsFromCart(tenantId, cartId);
      if (productsResult.status === "unavailable") return { status: "unavailable" };

      const quote = await calculateShipmentQuote({
        tenantId,
        originZip,
        destinationZip,
        products: productsResult.products,
        services: DEFAULT_MELHOR_ENVIO_SERVICES,
      });

      if (quote.status === "unavailable" || quote.options.length === 0) return { status: "unavailable" };

      return {
        status: "ok",
        options: quote.options.map((option) => ({
          id: option.serviceId,
          name: option.name,
          price: option.price,
          estimatedDays: option.deliveryTime,
          type: "melhor_envio",
        })),
      };
    },
  };
}
