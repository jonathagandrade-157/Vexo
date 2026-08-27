"use server";

import { revalidatePath } from "next/cache";

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizePixKey, pixSettingsSchema, type PixSettingsActionState, type PixSettingsInput } from "./pix-schema";

const PEDIDOS_SETTINGS_PATH = "/painel/configuracoes/pedidos";

/** Mesmo checklist de sempre — cópia local, não compartilhada (mesmo padrão de shipping/payments/checkout-actions.ts). */
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
    return { error: "Você não tem permissão para alterar a configuração de PIX." };
  }

  return { tenantId: membership.tenant.id };
}

/**
 * Fase D2-B (revisão final). A VEXO nunca gera/valida a chave junto de
 * nenhum provedor — só persiste o que o lojista digitou (normalizado por
 * tipo), sempre pertencente ao próprio tenant (nunca aceito de outro
 * lugar). Sem upload/OAuth/integração bancária nesta fase.
 */
export async function updatePixSettingsAction(
  _prevState: PixSettingsActionState,
  formData: FormData,
): Promise<PixSettingsActionState> {
  const parsed = pixSettingsSchema.safeParse({
    enabled: formData.get("enabled"),
    pixKeyType: formData.get("pixKeyType"),
    pixKey: formData.get("pixKey"),
    recipientName: formData.get("recipientName"),
  });
  if (!parsed.success) {
    const fieldErrors: PixSettingsActionState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof PixSettingsInput;
      fieldErrors[key] ??= issue.message;
    }
    return { status: "error", fieldErrors, message: "Verifique os campos destacados." };
  }

  const resolved = await resolveTenantAndPermission();
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const { enabled, pixKeyType, pixKey, recipientName } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("tenants")
    .update({
      pix_enabled: enabled,
      pix_key_type: pixKeyType ?? null,
      pix_key: pixKeyType && pixKey ? normalizePixKey(pixKeyType, pixKey) : (pixKey ?? null),
      pix_recipient_name: recipientName ?? null,
    })
    .eq("id", resolved.tenantId);

  if (error) {
    return { status: "error", message: "Não foi possível salvar a configuração de PIX. Tente novamente." };
  }

  revalidatePath(PEDIDOS_SETTINGS_PATH);
  return { status: "success", message: "Configuração de PIX salva." };
}
