import "server-only";

import { createSupabasePublicClient } from "@/lib/supabase/server";
import type { ShippingMethodType, ShippingProvider, ShippingQuoteResult } from "./provider";

/**
 * Única implementação real desta etapa — preço fixo por modalidade,
 * configurado pelo lojista em `shipping_methods` (prompt §6: "custo
 * fixo"). Não varia por CEP/peso (isso fica para um provedor de
 * transportadora real, fora do escopo aqui). Lê via `anon` client — as
 * mesmas policies RLS que o storefront já usa (Etapa 12 migration 046),
 * nunca um valor calculado no cliente.
 *
 * A query já não filtra por `type`, então retirada na loja (`pickup`) e
 * entrega própria (`own_delivery`) — D3.1 — fluem por aqui automaticamente,
 * junto com `flat_rate`, sem nenhum provedor novo.
 */
export function createFlatRateProvider(): ShippingProvider {
  return {
    type: "flat_rate",
    async getQuote(tenantId: string): Promise<ShippingQuoteResult> {
      const supabase = createSupabasePublicClient();

      const { data: settings } = await supabase
        .from("shipping_settings")
        .select("enabled")
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (!settings?.enabled) {
        return { status: "disabled" };
      }

      const { data: methods } = await supabase
        .from("shipping_methods")
        .select("id, name, price, estimated_days, type")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .order("sort_order", { ascending: true })
        .order("price", { ascending: true });

      if (!methods || methods.length === 0) {
        return { status: "unavailable" };
      }

      return {
        status: "ok",
        options: methods.map((m) => ({
          id: m.id,
          name: m.name,
          price: m.price,
          estimatedDays: m.estimated_days,
          type: m.type as ShippingMethodType,
        })),
      };
    },
  };
}
