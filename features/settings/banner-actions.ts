"use server";

import { revalidatePath } from "next/cache";

import {
  BANNER_MAX_BYTES,
  buildBannerPath,
  hasReachedBannerLimit,
  MAX_BANNERS_PER_TENANT,
  sniffLogoMime,
  TENANT_MEDIA_BUCKET,
} from "./banner-storage";
import { bannerFieldsSchema, type BannerActionState, type BannerFieldsInput } from "./banner-schema";
import { resolveTenantWithSettingsPermission } from "./appearance-actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const APARENCIA_PATH = "/painel/aparencia";

function fieldErrorsFrom(parsed: ReturnType<typeof bannerFieldsSchema.safeParse>): BannerActionState["fieldErrors"] {
  if (parsed.success) return undefined;
  const fieldErrors: BannerActionState["fieldErrors"] = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof BannerFieldsInput;
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

function parseBannerFields(formData: FormData) {
  return bannerFieldsSchema.safeParse({
    title: formData.get("title"),
    linkUrl: formData.get("linkUrl"),
    status: formData.get("status") || "active",
  });
}

/**
 * Sprint 1 — Fase C2. Imagem obrigatória só ao criar (§13/§15 da
 * auditoria) — validada aqui, fora do Zod, mesmo padrão de
 * `uploadStoreLogoAction`. Ordem de segurança idêntica: sobe o arquivo
 * NOVO primeiro (com um id gerado em código, não pelo INSERT, porque o
 * path do storage precisa do id antes da linha existir), só então insere
 * a linha — nunca um registro apontando para uma imagem que não subiu.
 */
export async function createBannerAction(_prevState: BannerActionState, formData: FormData): Promise<BannerActionState> {
  const parsed = parseBannerFields(formData);
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFrom(parsed), message: "Verifique os campos destacados." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Selecione uma imagem para o banner." };
  }
  if (file.size > BANNER_MAX_BYTES) {
    return { status: "error", message: "Imagem muito grande. O limite é 5MB." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffLogoMime(bytes);
  if (!mime) {
    return { status: "error", message: "Formato não suportado. Envie um JPEG, PNG ou WebP." };
  }

  const resolved = await resolveTenantWithSettingsPermission();
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();

  const { data: existing, count } = await supabase
    .from("storefront_banners")
    .select("sort_order", { count: "exact" })
    .eq("tenant_id", resolved.tenantId)
    .order("sort_order", { ascending: false })
    .limit(1);

  if (hasReachedBannerLimit(count ?? 0)) {
    return { status: "error", message: `Limite de ${MAX_BANNERS_PER_TENANT} banners por loja atingido.` };
  }
  // Sempre no fim da lista (maior sort_order + 1) — nunca 0 fixo, senão
  // todo banner novo nasceria empatado com os outros e "↑"/"↓" (troca de
  // sort_order com o vizinho) nunca teria efeito visível.
  const nextSortOrder = existing && existing.length > 0 ? existing[0]!.sort_order + 1 : 0;

  const bannerId = crypto.randomUUID();
  const path = buildBannerPath(resolved.tenantId, bannerId, mime);

  const { error: uploadError } = await supabase.storage.from(TENANT_MEDIA_BUCKET).upload(path, file, { contentType: mime });
  if (uploadError) {
    return { status: "error", message: "Não foi possível enviar a imagem. Tente novamente." };
  }

  const { error: insertError } = await supabase.from("storefront_banners").insert({
    id: bannerId,
    tenant_id: resolved.tenantId,
    image_path: path,
    title: parsed.data.title,
    link_url: parsed.data.linkUrl,
    status: parsed.data.status,
    sort_order: nextSortOrder,
  });

  if (insertError) {
    // Registro não foi criado — remove o arquivo órfão em vez de deixá-lo parado sem nenhuma linha apontando para ele.
    await supabase.storage.from(TENANT_MEDIA_BUCKET).remove([path]);
    return { status: "error", message: "Não foi possível criar o banner. Tente novamente." };
  }

  revalidatePath(APARENCIA_PATH);
  return { status: "success", message: "Banner criado." };
}

/**
 * Imagem é opcional aqui — trocar só título/link/status não precisa
 * reenviar nada. Quando uma nova imagem vem, mesma ordem de segurança:
 * sobe a nova, atualiza a linha, só then remove a antiga (se o path
 * mudou — a extensão pode mudar entre formatos diferentes).
 */
export async function updateBannerAction(_prevState: BannerActionState, formData: FormData): Promise<BannerActionState> {
  const bannerId = formData.get("bannerId");
  if (typeof bannerId !== "string" || bannerId.length === 0) {
    return { status: "error", message: "Banner inválido." };
  }

  const parsed = parseBannerFields(formData);
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFrom(parsed), message: "Verifique os campos destacados." };
  }

  const resolved = await resolveTenantWithSettingsPermission();
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();

  const file = formData.get("file");
  const hasNewFile = file instanceof File && file.size > 0;

  let newPath: string | null = null;
  let previousPath: string | null = null;

  if (hasNewFile) {
    if (file.size > BANNER_MAX_BYTES) {
      return { status: "error", message: "Imagem muito grande. O limite é 5MB." };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniffLogoMime(bytes);
    if (!mime) {
      return { status: "error", message: "Formato não suportado. Envie um JPEG, PNG ou WebP." };
    }

    const { data: current } = await supabase
      .from("storefront_banners")
      .select("image_path")
      .eq("id", bannerId)
      .eq("tenant_id", resolved.tenantId)
      .maybeSingle();
    if (!current) return { status: "error", message: "Banner não encontrado." };
    previousPath = current.image_path as string;

    newPath = buildBannerPath(resolved.tenantId, bannerId, mime);
    const { error: uploadError } = await supabase.storage.from(TENANT_MEDIA_BUCKET).upload(newPath, file, {
      contentType: mime,
      upsert: true,
    });
    if (uploadError) {
      return { status: "error", message: "Não foi possível enviar a nova imagem. Tente novamente." };
    }
  }

  const { error: updateError, count } = await supabase
    .from("storefront_banners")
    .update(
      {
        title: parsed.data.title,
        link_url: parsed.data.linkUrl,
        status: parsed.data.status,
        ...(newPath ? { image_path: newPath } : {}),
      },
      { count: "exact" },
    )
    .eq("id", bannerId)
    .eq("tenant_id", resolved.tenantId);

  if (updateError) {
    return { status: "error", message: "Não foi possível salvar o banner. Tente novamente." };
  }
  if (!count) {
    return { status: "error", message: "Banner não encontrado." };
  }

  if (newPath && previousPath && previousPath !== newPath) {
    await supabase.storage.from(TENANT_MEDIA_BUCKET).remove([previousPath]);
  }

  revalidatePath(APARENCIA_PATH);
  return { status: "success", message: "Banner atualizado." };
}

/** Remove a linha primeiro (nunca deixa nada apontando para a imagem enquanto ela ainda existe), só depois o objeto do storage — pior caso de falha no meio é um arquivo órfão, nunca uma referência quebrada. */
export async function deleteBannerAction(bannerId: string): Promise<BannerActionState> {
  const resolved = await resolveTenantWithSettingsPermission();
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();

  const { data: current } = await supabase
    .from("storefront_banners")
    .select("image_path")
    .eq("id", bannerId)
    .eq("tenant_id", resolved.tenantId)
    .maybeSingle();
  if (!current) return { status: "error", message: "Banner não encontrado." };

  const { error, count } = await supabase
    .from("storefront_banners")
    .delete({ count: "exact" })
    .eq("id", bannerId)
    .eq("tenant_id", resolved.tenantId);

  if (error) return { status: "error", message: "Não foi possível excluir o banner. Tente novamente." };
  if (!count) return { status: "error", message: "Banner não encontrado." };

  await supabase.storage.from(TENANT_MEDIA_BUCKET).remove([current.image_path as string]);

  revalidatePath(APARENCIA_PATH);
  return { status: "success" };
}

export async function toggleBannerStatusAction(bannerId: string, nextStatus: "active" | "inactive"): Promise<BannerActionState> {
  const resolved = await resolveTenantWithSettingsPermission();
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();
  const { error, count } = await supabase
    .from("storefront_banners")
    .update({ status: nextStatus }, { count: "exact" })
    .eq("id", bannerId)
    .eq("tenant_id", resolved.tenantId);

  if (error) return { status: "error", message: "Não foi possível atualizar o status. Tente novamente." };
  if (!count) return { status: "error", message: "Banner não encontrado." };

  revalidatePath(APARENCIA_PATH);
  return { status: "success" };
}

/**
 * "↑"/"↓" do card — troca `sort_order` com o vizinho na direção pedida.
 * Lê a lista inteira (no máximo 5 linhas, nunca um problema de escala) já
 * ordenada, localiza o índice, troca os dois valores. Sem trigger/lock
 * novo — é um lojista clicando uma seta, não uma corrida concorrente.
 */
export async function moveBannerAction(bannerId: string, direction: "up" | "down"): Promise<BannerActionState> {
  const resolved = await resolveTenantWithSettingsPermission();
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();
  const { data: banners } = await supabase
    .from("storefront_banners")
    .select("id, sort_order")
    .eq("tenant_id", resolved.tenantId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const list = banners ?? [];
  const index = list.findIndex((b) => b.id === bannerId);
  if (index === -1) return { status: "error", message: "Banner não encontrado." };

  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= list.length) {
    return { status: "success" };
  }

  const current = list[index]!;
  const target = list[targetIndex]!;

  const [{ error: error1 }, { error: error2 }] = await Promise.all([
    supabase.from("storefront_banners").update({ sort_order: target.sort_order }).eq("id", current.id).eq("tenant_id", resolved.tenantId),
    supabase.from("storefront_banners").update({ sort_order: current.sort_order }).eq("id", target.id).eq("tenant_id", resolved.tenantId),
  ]);

  if (error1 || error2) {
    return { status: "error", message: "Não foi possível reordenar. Tente novamente." };
  }

  revalidatePath(APARENCIA_PATH);
  return { status: "success" };
}
