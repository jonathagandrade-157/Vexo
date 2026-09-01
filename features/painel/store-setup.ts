import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { BusinessType } from "@/features/onboarding/step-definitions";
import { buildStoreSetupChecklist, type StoreSetupChecklist, type StoreSetupRawSignals } from "./store-setup-logic";

interface TenantIdentitySignals {
  name: string;
  segment: string | null;
  instagram_handle: string | null;
  whatsapp_phone: string | null;
  contact_email: string | null;
  logo_url: string | null;
}

/**
 * D12.2.2 — resolve o checklist de configuração real do tenant. UMA
 * chamada (`Promise.all`), mesmo padrão já usado por `/painel/aparencia`
 * (7 queries em paralelo) — nunca N chamadas sequenciais nem nada
 * client-side (D12.2.2 §14: "preferir uma consulta server-side agregada").
 *
 * Tenant sempre vem já resolvido pela sessão (`getCurrentMembership()`,
 * chamado por quem chama esta função) — nunca um `tenantId` de
 * parâmetro de rota/formulário. Toda query abaixo roda no client
 * Supabase ligado à sessão (nunca `service_role`), filtrada por
 * `tenant_id`, e a RLS de cada tabela (já existente, nenhuma alterada
 * aqui) continua sendo a autoridade final de isolamento — mesmo
 * princípio de defesa em profundidade do resto do projeto.
 */
export async function resolveStoreSetupChecklist(
  supabase: SupabaseClient,
  tenantId: string,
  businessType: BusinessType | null,
): Promise<StoreSetupChecklist> {
  const [
    { data: tenantRow },
    { count: productCount },
    { count: categoryCount },
    { data: paymentRow },
    { data: shippingSettingsRow },
    { count: activeShippingMethodCount },
  ] = await Promise.all([
    supabase
      .from("tenants")
      .select("name, segment, instagram_handle, whatsapp_phone, contact_email, logo_url")
      .eq("id", tenantId)
      .maybeSingle<TenantIdentitySignals>(),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    supabase.from("categories").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    supabase
      .from("store_payment_providers")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("provider", "mercadopago")
      .maybeSingle<{ status: string }>(),
    supabase.from("shipping_settings").select("enabled").eq("tenant_id", tenantId).maybeSingle<{ enabled: boolean }>(),
    supabase
      .from("shipping_methods")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "active"),
  ]);

  const raw: StoreSetupRawSignals = {
    storeName: tenantRow?.name ?? "",
    segment: tenantRow?.segment ?? null,
    instagramHandle: tenantRow?.instagram_handle ?? null,
    whatsappPhone: tenantRow?.whatsapp_phone ?? null,
    contactEmail: tenantRow?.contact_email ?? null,
    logoUrl: tenantRow?.logo_url ?? null,
    productCount: productCount ?? 0,
    categoryCount: categoryCount ?? 0,
    paymentConnected: paymentRow?.status === "connected",
    shippingEnabled: shippingSettingsRow?.enabled ?? false,
    activeShippingMethodCount: activeShippingMethodCount ?? 0,
  };

  return buildStoreSetupChecklist(raw, businessType);
}
