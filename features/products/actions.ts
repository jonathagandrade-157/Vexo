"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils/slugify";
import {
  buildProductImagePath,
  PRODUCT_IMAGE_BUCKET,
  PRODUCT_IMAGE_MAX_BYTES,
  sniffImageMime,
} from "./image-storage";
import {
  productSchema,
  type ProductActionState,
  type ProductImageActionState,
  type ProductInput,
} from "./schema";

/** Mesmo checklist/padrão de features/categories/actions.ts — não duplicado como função exportada porque cada domínio checa a permission key própria. */
async function resolveTenantAndPermission(
  permissionKey: string,
): Promise<{ tenantId: string } | { error: string }> {
  const supabase = await createSupabaseServerClient();
  const membership = await resolveActiveTenantForUser(supabase);
  if (!membership || membership.tenant.onboarding_completed_at === null) {
    return { error: "Nenhuma loja configurada para esta conta." };
  }

  const { data: allowed } = await supabase.rpc("has_permission", {
    p_tenant_id: membership.tenant.id,
    p_permission_key: permissionKey,
  });
  if (!allowed) {
    return { error: "Você não tem permissão para esta ação." };
  }

  return { tenantId: membership.tenant.id };
}

function parseProductForm(formData: FormData) {
  return productSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    price: formData.get("price"),
    promotionalPrice: formData.get("promotionalPrice"),
    sku: formData.get("sku"),
    categoryId: formData.get("categoryId"),
    weight: formData.get("weight"),
    height: formData.get("height"),
    width: formData.get("width"),
    length: formData.get("length"),
  });
}

function fieldErrorsFrom(
  parsed: ReturnType<typeof parseProductForm>,
): ProductActionState["fieldErrors"] {
  if (parsed.success) return undefined;
  const fieldErrors: ProductActionState["fieldErrors"] = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof ProductInput;
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

export async function createProductAction(
  _prevState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const parsed = parseProductForm(formData);
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFrom(parsed), message: "Verifique os campos destacados." };
  }

  const resolved = await resolveTenantAndPermission("products.create");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();

  // Etapa 16 §9 (passo 4 do checklist): tenant com trial expirado/loja
  // suspensa não pode continuar cadastrando — mesma fonte oficial de
  // sempre (tenant_access_status, Etapa 14), nunca uma checagem própria.
  const { data: accessStatus } = await supabase.rpc("tenant_access_status", { p_tenant_id: resolved.tenantId });
  if (accessStatus !== "ACTIVE" && accessStatus !== "TRIALING") {
    return { status: "error", message: "Sua loja não está com acesso ativo no momento. Verifique o status da sua assinatura." };
  }

  const slug = slugify(parsed.data.name);

  const { data: created, error } = await supabase
    .from("products")
    .insert({
      tenant_id: resolved.tenantId,
      category_id: parsed.data.categoryId ?? null,
      name: parsed.data.name,
      slug,
      description: parsed.data.description ?? null,
      price: parsed.data.price,
      promotional_price: parsed.data.promotionalPrice ?? null,
      sku: parsed.data.sku ?? null,
      weight: parsed.data.weight ?? null,
      height: parsed.data.height ?? null,
      width: parsed.data.width ?? null,
      length: parsed.data.length ?? null,
    })
    .select("id")
    .single();

  if (error) {
    // Etapa 16 §7/§9: VX011/VX010 vêm do trigger de enforcement de limite
    // (migration 20260817220065) — verificado no servidor, atômico sob
    // concorrência, nunca confiado só na UI.
    if (error.code === "VX011") {
      return {
        status: "error",
        message: "Você atingiu o limite de produtos do seu plano atual. Faça upgrade para continuar cadastrando produtos.",
      };
    }
    if (error.code === "VX010") {
      return { status: "error", message: "Não foi possível verificar o limite do seu plano. Tente novamente ou contate o suporte." };
    }
    if (error.code === "23505") {
      return {
        status: "error",
        fieldErrors: { name: "Já existe um produto com esse nome nesta loja." },
        message: "Verifique os campos destacados.",
      };
    }
    if (error.code === "23514") {
      return { status: "error", message: "Verifique os valores informados (categoria, preço ou peso/dimensões)." };
    }
    return { status: "error", message: "Não foi possível criar o produto. Tente novamente." };
  }

  revalidatePath("/painel/produtos");
  // Etapa 8: vai direto para a edição em vez da lista — é lá que a
  // imagem pode ser adicionada, já com um product_id real para compor o
  // path do Storage (arquitetura §9.2: o path nunca é conhecido antes de
  // o produto existir).
  redirect(`/painel/produtos/${created.id}/editar`);
}

export async function updateProductAction(
  _prevState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const productId = formData.get("productId");
  if (typeof productId !== "string" || productId.length === 0) {
    return { status: "error", message: "Produto inválido." };
  }

  const parsed = parseProductForm(formData);
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFrom(parsed), message: "Verifique os campos destacados." };
  }

  const resolved = await resolveTenantAndPermission("products.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();

  const { error, count } = await supabase
    .from("products")
    .update(
      {
        category_id: parsed.data.categoryId ?? null,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        price: parsed.data.price,
        promotional_price: parsed.data.promotionalPrice ?? null,
        sku: parsed.data.sku ?? null,
        weight: parsed.data.weight ?? null,
        height: parsed.data.height ?? null,
        width: parsed.data.width ?? null,
        length: parsed.data.length ?? null,
      },
      { count: "exact" },
    )
    .eq("id", productId)
    .eq("tenant_id", resolved.tenantId);

  if (error) {
    if (error.code === "23505") {
      return {
        status: "error",
        fieldErrors: { name: "Já existe um produto com esse nome nesta loja." },
        message: "Verifique os campos destacados.",
      };
    }
    if (error.code === "23514") {
      return { status: "error", message: "Verifique os valores informados (categoria, preço ou peso/dimensões)." };
    }
    return { status: "error", message: "Não foi possível salvar o produto. Tente novamente." };
  }
  if (!count) {
    return { status: "error", message: "Produto não encontrado." };
  }

  revalidatePath("/painel/produtos");
  redirect("/painel/produtos");
}

export async function deleteProductAction(productId: string): Promise<ProductActionState> {
  const resolved = await resolveTenantAndPermission("products.delete");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();
  const { error, count } = await supabase
    .from("products")
    .delete({ count: "exact" })
    .eq("id", productId)
    .eq("tenant_id", resolved.tenantId);

  if (error) {
    return { status: "error", message: "Não foi possível excluir o produto. Tente novamente." };
  }
  if (!count) {
    return { status: "error", message: "Produto não encontrado." };
  }

  revalidatePath("/painel/produtos");
  return { status: "success", message: "Produto excluído." };
}

export async function toggleProductStatusAction(
  productId: string,
  nextStatus: "active" | "inactive",
): Promise<ProductActionState> {
  const resolved = await resolveTenantAndPermission("products.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();
  const { error, count } = await supabase
    .from("products")
    .update({ status: nextStatus }, { count: "exact" })
    .eq("id", productId)
    .eq("tenant_id", resolved.tenantId);

  if (error) {
    return { status: "error", message: "Não foi possível atualizar o status. Tente novamente." };
  }
  if (!count) {
    return { status: "error", message: "Produto não encontrado." };
  }

  revalidatePath("/painel/produtos");
  return { status: "success" };
}

/**
 * Busca o produto escopado por tenant (defesa em profundidade além da
 * RLS, mesmo padrão do resto do arquivo) — usado pelas duas actions de
 * imagem abaixo para confirmar posse antes de tocar o Storage.
 */
async function resolveOwnedProduct(
  productId: string,
  tenantId: string,
): Promise<{ id: string; main_image: string | null } | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("products")
    .select("id, main_image")
    .eq("id", productId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data;
}

/**
 * Upload/substituição da imagem de um produto já existente (Etapa 8).
 * Só disponível na edição, nunca na criação — o path do Storage depende
 * de um product_id real (arquitetura §9.2), e gerar um id antecipado só
 * para permitir upload durante a criação criaria risco de arquivo órfão
 * se o formulário for abandonado sem salvar.
 *
 * Ordem: sessão → tenant → membership → permissão → produto pertence ao
 * tenant → arquivo é validado (tamanho, depois bytes mágicos reais,
 * nunca o Content-Type/nome enviados pelo browser) → path gerado no
 * servidor → Storage (client de sessão, nunca service_role — a RLS de
 * storage.objects, migration 20260817220028, é a segunda camada) →
 * products.main_image atualizado só depois do upload confirmado.
 */
export async function uploadProductImageAction(
  productId: string,
  _prevState: ProductImageActionState,
  formData: FormData,
): Promise<ProductImageActionState> {
  const resolved = await resolveTenantAndPermission("products.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const product = await resolveOwnedProduct(productId, resolved.tenantId);
  if (!product) return { status: "error", message: "Produto não encontrado." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Selecione um arquivo de imagem." };
  }
  if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
    return { status: "error", message: "Imagem muito grande. O limite é 5MB." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImageMime(bytes);
  if (!mime) {
    return { status: "error", message: "Formato não suportado. Envie um JPEG, PNG ou WebP." };
  }

  const supabase = await createSupabaseServerClient();
  const newPath = buildProductImagePath(resolved.tenantId, productId, mime);

  // Ordem importa para nunca deixar o produto apontando para um arquivo
  // que não existe (prompt §17): sobe o arquivo NOVO primeiro, só depois
  // de confirmado é que o produto passa a apontar para ele, e só então o
  // objeto antigo (se a extensão mudou) é removido. Se qualquer passo
  // falhar antes do fim, o pior caso é um arquivo órfão remanescente —
  // nunca uma imagem quebrada para o lojista.
  const { error: uploadError } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(newPath, file, { contentType: mime, upsert: true });

  if (uploadError) {
    return { status: "error", message: "Não foi possível enviar a imagem. Tente novamente." };
  }

  const { error: updateError } = await supabase
    .from("products")
    .update({ main_image: newPath })
    .eq("id", productId)
    .eq("tenant_id", resolved.tenantId);

  if (updateError) {
    // Rollback: o arquivo já foi gravado no Storage, mas o produto não
    // foi atualizado — remove o objeto recém-enviado para não deixar um
    // arquivo válido sem nenhuma linha apontando para ele (prompt §17).
    await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([newPath]);
    return { status: "error", message: "Não foi possível salvar a imagem no produto. Tente novamente." };
  }

  // Só agora, com o produto já apontando para o arquivo novo confirmado,
  // é seguro remover o objeto antigo (path diferente = extensão trocada
  // — `upsert` não teria sobrescrito). Best-effort: uma falha aqui deixa
  // só um arquivo órfão inofensivo, nunca uma imagem quebrada.
  if (product.main_image && product.main_image !== newPath) {
    await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([product.main_image]);
  }

  revalidatePath("/painel/produtos");
  revalidatePath(`/painel/produtos/${productId}/editar`);
  return { status: "success", imagePath: newPath };
}

/** Remove a imagem de um produto já existente (Etapa 8). Mesmo checklist da action acima. */
export async function removeProductImageAction(productId: string): Promise<ProductImageActionState> {
  const resolved = await resolveTenantAndPermission("products.delete");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const product = await resolveOwnedProduct(productId, resolved.tenantId);
  if (!product) return { status: "error", message: "Produto não encontrado." };
  if (!product.main_image) return { status: "success", imagePath: null };

  const supabase = await createSupabaseServerClient();
  const { error: removeError } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([product.main_image]);
  if (removeError) {
    return { status: "error", message: "Não foi possível remover a imagem. Tente novamente." };
  }

  const { error: updateError } = await supabase
    .from("products")
    .update({ main_image: null })
    .eq("id", productId)
    .eq("tenant_id", resolved.tenantId);

  if (updateError) {
    return { status: "error", message: "Não foi possível remover a imagem. Tente novamente." };
  }

  revalidatePath("/painel/produtos");
  revalidatePath(`/painel/produtos/${productId}/editar`);
  return { status: "success", imagePath: null };
}
