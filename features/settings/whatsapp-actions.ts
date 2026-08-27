"use server";

import { revalidatePath } from "next/cache";

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { whatsappSettingsSchema, type WhatsappSettingsActionState, type WhatsappSettingsInput } from "./whatsapp-schema";

const PEDIDOS_SETTINGS_PATH = "/painel/configuracoes/pedidos";

/** Mesmo checklist de sempre — cópia local, não compartilhada (mesmo padrão de shipping/payments/checkout-actions.ts/pix-actions.ts). */
async function resolveTenantAndPermission(): Promise<{ tenantId: string } | { error: string }> {
  const supabase = await createSupabaseServerClient();
  const membership = await resolveActiveTenantForUser(supabase);
  if (!membership || membership.tenant.onboarding_completed_at === null) {
    return { error: "Nenhuma loja configurada para esta conta." };
  }

  const { data: allowed } = await supabase.rpc("has_permission", {
    p_tenant_id: membership.tenant.id,
    p_permission_key: "settings.update",
  });
  if (!allowed) {
    return { error: "Você não tem permissão para alterar o WhatsApp da loja." };
  }

  return { tenantId: membership.tenant.id };
}

/**
 * Fase D2-B.1. Único caminho para editar `tenants.whatsapp_phone` — o
 * campo saiu de `updateStoreProfileAction` (Etapa 5) para nunca haver
 * dois formulários gravando a mesma coluna. `tenant_id` sempre resolvido
 * da sessão (nunca de `formData`); nenhum "link"/"destino" é aceito como
 * parâmetro — o único dado que entra é o número em si, e ele já sai do
 * schema normalizado (`whatsappSettingsSchema`), nunca o texto bruto
 * digitado.
 */
export async function updateWhatsappSettingsAction(
  _prevState: WhatsappSettingsActionState,
  formData: FormData,
): Promise<WhatsappSettingsActionState> {
  const parsed = whatsappSettingsSchema.safeParse({
    whatsappPhone: formData.get("whatsappPhone"),
  });
  if (!parsed.success) {
    const fieldErrors: WhatsappSettingsActionState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof WhatsappSettingsInput;
      fieldErrors[key] ??= issue.message;
    }
    return { status: "error", fieldErrors, message: "Verifique o número informado." };
  }

  const resolved = await resolveTenantAndPermission();
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("tenants")
    .update({ whatsapp_phone: parsed.data.whatsappPhone })
    .eq("id", resolved.tenantId);

  if (error) {
    return { status: "error", message: "Não foi possível salvar o WhatsApp. Tente novamente." };
  }

  revalidatePath(PEDIDOS_SETTINGS_PATH);
  return { status: "success", message: "WhatsApp para pedidos salvo." };
}
