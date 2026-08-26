"use server";

import { revalidatePath } from "next/cache";

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  storeAppearanceSchema,
  type StoreAppearanceActionState,
  type StoreAppearanceInput,
  type StoreLogoActionState,
} from "./appearance-schema";
import { buildLogoPath, LOGO_MAX_BYTES, sniffLogoMime, TENANT_MEDIA_BUCKET } from "./logo-storage";

/**
 * Sprint 1 — Fase A. Mesmo padrão de `resolveTenantAndPermission` em
 * `features/products/actions.ts` (Etapa 8) — cada domínio checa a
 * permission key própria; não extraído como helper compartilhado por não
 * dever tocar arquivos de catálogo nesta Sprint. `settings.update` é a
 * mesma permissão que já governa o resto do "perfil da loja"
 * (`updateStoreProfileAction`) — identidade visual faz parte do mesmo
 * conjunto de configuração, não um recurso à parte.
 */
export async function resolveTenantWithSettingsPermission(): Promise<{ tenantId: string } | { error: string }> {
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
    return { error: "Você não tem permissão para editar a aparência da loja." };
  }

  return { tenantId: membership.tenant.id };
}

function parseAppearanceForm(formData: FormData) {
  return storeAppearanceSchema.safeParse({
    primaryColor: formData.get("primaryColor"),
    secondaryColor: formData.get("secondaryColor"),
    storefrontTemplate: formData.get("storefrontTemplate"),
  });
}

function fieldErrorsFrom(
  parsed: ReturnType<typeof parseAppearanceForm>,
): StoreAppearanceActionState["fieldErrors"] {
  if (parsed.success) return undefined;
  const fieldErrors: StoreAppearanceActionState["fieldErrors"] = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof StoreAppearanceInput;
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

/**
 * Salva cor primária/secundária + modelo escolhido. Nunca toca
 * logo_url (isso é exclusivo de `uploadStoreLogoAction`/
 * `removeStoreLogoAction`, que já persistem imediatamente ao trocar de
 * arquivo — mesmo princípio de "persistir de cada vez", nunca acumular
 * mudança de imagem num state pendente de "Salvar alterações").
 */
export async function updateStoreAppearanceAction(
  _prevState: StoreAppearanceActionState,
  formData: FormData,
): Promise<StoreAppearanceActionState> {
  const parsed = parseAppearanceForm(formData);
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFrom(parsed), message: "Verifique os campos destacados." };
  }

  const resolved = await resolveTenantWithSettingsPermission();
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();
  const { primaryColor, secondaryColor, storefrontTemplate } = parsed.data;

  const { error } = await supabase
    .from("tenants")
    .update({
      primary_color: primaryColor,
      secondary_color: secondaryColor,
      storefront_template: storefrontTemplate,
    })
    .eq("id", resolved.tenantId);

  if (error) {
    return { status: "error", message: "Não foi possível salvar a aparência da loja. Tente novamente." };
  }

  revalidatePath("/painel/aparencia");
  return { status: "success", message: "Aparência salva." };
}

export async function uploadStoreLogoAction(
  _prevState: StoreLogoActionState,
  formData: FormData,
): Promise<StoreLogoActionState> {
  const resolved = await resolveTenantWithSettingsPermission();
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Selecione um arquivo de imagem." };
  }
  if (file.size > LOGO_MAX_BYTES) {
    return { status: "error", message: "Imagem muito grande. O limite é 5MB." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffLogoMime(bytes);
  if (!mime) {
    return { status: "error", message: "Formato não suportado. Envie um JPEG, PNG ou WebP." };
  }

  const supabase = await createSupabaseServerClient();
  const newPath = buildLogoPath(resolved.tenantId, mime);

  const { data: current } = await supabase
    .from("tenants")
    .select("logo_url")
    .eq("id", resolved.tenantId)
    .maybeSingle();
  const previousPath = (current?.logo_url as string | null) ?? null;

  // Mesma ordem de segurança de uploadProductImageAction (Etapa 8): sobe
  // o arquivo NOVO primeiro, só depois de confirmado é que o tenant passa
  // a apontar para ele, e só então o objeto antigo (se a extensão mudou)
  // é removido. Pior caso de falha no meio do caminho é um arquivo
  // órfão — nunca uma logo quebrada para o lojista.
  const { error: uploadError } = await supabase.storage
    .from(TENANT_MEDIA_BUCKET)
    .upload(newPath, file, { contentType: mime, upsert: true });

  if (uploadError) {
    return { status: "error", message: "Não foi possível enviar a logo. Tente novamente." };
  }

  const { error: updateError } = await supabase
    .from("tenants")
    .update({ logo_url: newPath })
    .eq("id", resolved.tenantId);

  if (updateError) {
    return { status: "error", message: "Não foi possível salvar a logo. Tente novamente." };
  }

  if (previousPath && previousPath !== newPath) {
    await supabase.storage.from(TENANT_MEDIA_BUCKET).remove([previousPath]);
  }

  revalidatePath("/painel/aparencia");
  return { status: "success", logoPath: newPath };
}

export async function removeStoreLogoAction(): Promise<StoreLogoActionState> {
  const resolved = await resolveTenantWithSettingsPermission();
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();

  const { data: current } = await supabase
    .from("tenants")
    .select("logo_url")
    .eq("id", resolved.tenantId)
    .maybeSingle();
  const currentPath = (current?.logo_url as string | null) ?? null;
  if (!currentPath) return { status: "success", logoPath: null };

  const { error: removeError } = await supabase.storage.from(TENANT_MEDIA_BUCKET).remove([currentPath]);
  if (removeError) {
    return { status: "error", message: "Não foi possível remover a logo. Tente novamente." };
  }

  const { error: updateError } = await supabase
    .from("tenants")
    .update({ logo_url: null })
    .eq("id", resolved.tenantId);

  if (updateError) {
    return { status: "error", message: "Não foi possível remover a logo. Tente novamente." };
  }

  revalidatePath("/painel/aparencia");
  return { status: "success", logoPath: null };
}
