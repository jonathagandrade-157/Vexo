"use server";

import { redirect } from "next/navigation";

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { storeProfileSchema, type StoreProfileInput } from "./schema";

export interface StoreProfileActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<keyof StoreProfileInput, string>>;
}

export const initialStoreProfileState: StoreProfileActionState = { status: "idle" };

/**
 * Edita os dados da loja depois do onboarding (arquitetura §11/§12 Etapa
 * 5). Mesmo padrão de `features/onboarding/actions.ts::saveBrandInfoAction`
 * — tenant sempre resolvido da sessão (nunca de campo de formulário), mas
 * aqui via `resolveActiveTenantForUser` (qualquer papel ativo, não só
 * OWNER) porque ADMIN também tem `settings.update` (Etapa 2).
 *
 * "verificar permission" (§12) é feito explicitamente aqui, via o wrapper
 * `public.has_permission()` (migration 20260817220020) — não só confiado
 * ao UPDATE falhar silenciosamente por RLS. RLS continua sendo a
 * autoridade final (defesa em profundidade, não substituição): mesmo que
 * este check tivesse um bug, a policy de `tenants` (Etapa 2) ainda barra
 * o UPDATE de quem não tem `settings.update`.
 *
 * Não toca `onboarding_completed_at` — isso é exclusivo do fluxo de
 * conclusão do onboarding (Etapa 4); esta Action só atualiza os campos
 * de perfil da loja (Fase D2-B.1: `whatsapp_phone` saiu daqui, ver
 * `features/settings/whatsapp-actions.ts`).
 */
export async function updateStoreProfileAction(
  _prevState: StoreProfileActionState,
  formData: FormData,
): Promise<StoreProfileActionState> {
  const parsed = storeProfileSchema.safeParse({
    storeName: formData.get("storeName"),
    segment: formData.get("segment"),
    description: formData.get("description"),
    instagram: formData.get("instagram"),
    email: formData.get("email"),
  });

  if (!parsed.success) {
    const fieldErrors: StoreProfileActionState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof StoreProfileInput;
      fieldErrors[key] ??= issue.message;
    }
    return {
      status: "error",
      fieldErrors,
      message: "Verifique os campos destacados.",
    };
  }

  const supabase = await createSupabaseServerClient();

  const membership = await resolveActiveTenantForUser(supabase);
  if (!membership) redirect("/sem-loja");
  if (membership.tenant.onboarding_completed_at === null) redirect("/onboarding");

  const { data: allowed } = await supabase.rpc("has_permission", {
    p_tenant_id: membership.tenant.id,
    p_permission_key: "settings.update",
  });

  if (!allowed) {
    return {
      status: "error",
      message: "Você não tem permissão para editar as configurações da loja.",
    };
  }

  const { storeName, segment, description, instagram, email } = parsed.data;

  const { error } = await supabase
    .from("tenants")
    .update({
      name: storeName,
      segment,
      description: description ?? null,
      instagram_handle: instagram,
      contact_email: email,
    })
    .eq("id", membership.tenant.id);

  if (error) {
    return {
      status: "error",
      message: "Não foi possível salvar as alterações. Tente novamente.",
    };
  }

  return { status: "success", message: "Alterações salvas." };
}
