"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils/slugify";
import {
  buildProductImagePath,
  isValidProductImagePath,
  PRODUCT_IMAGE_BUCKET,
  validateProductImageUploadRequest,
} from "./image-storage";
import {
  productSchema,
  type PrepareProductImageActionState,
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

const PRODUCT_IMAGE_UPLOAD_REQUEST_ERROR_MESSAGE: Record<string, string> = {
  empty: "Selecione um arquivo de imagem.",
  too_large: "Imagem muito grande. O limite é 5MB.",
  unsupported_mime: "Formato não suportado. Envie um JPEG, PNG ou WebP.",
};

/**
 * D11.8 — arquitetura definitiva de upload de imagem de produto: upload
 * direto do navegador para o Supabase Storage via signed upload URL, em
 * vez de o arquivo atravessar o body da Server Action (que esbarrava no
 * limite de 1MB do Next.js, e possivelmente num teto ainda menor da
 * própria Vercel para Serverless Functions — nunca confirmado com
 * certeza, ver relatório). O arquivo INTEIRO nunca chega a este
 * processo: só um prefixo de bytes (o suficiente para o sniff de
 * assinatura real) e o tamanho declarado.
 *
 * Só disponível na edição, nunca na criação — o path do Storage depende
 * de um product_id real (arquitetura §9.2), e gerar um id antecipado só
 * para permitir upload durante a criação criaria risco de arquivo órfão
 * se o formulário for abandonado sem salvar.
 *
 * Ordem: sessão → tenant → membership → permissão (`products.update`) →
 * produto pertence ao tenant → prefixo de bytes é validado (tamanho
 * declarado, depois bytes mágicos reais do prefixo, nunca o
 * Content-Type/nome enviados pelo browser) → path gerado no servidor →
 * `createSignedUploadUrl` (client de sessão, nunca service_role — a
 * mesma policy de INSERT em storage.objects, migration
 * 20260817220028, § "tenant staff can upload product-media", é avaliada
 * neste exato passo, contra o path que o servidor acabou de montar).
 *
 * `uploadToSignedUrl` (chamado pelo cliente com o token devolvido aqui)
 * não exige NENHUMA policy de storage.objects — o token já é a
 * autorização (2h de validade, SDK `@supabase/storage-js`). É por isso
 * que o path nunca pode vir do cliente: o servidor é a única barreira
 * entre "usuário com products.update no tenant X" e "pode escrever em
 * qualquer path" — cada signed URL só vale para o path exato montado
 * aqui.
 */
export async function prepareProductImageUploadAction(
  productId: string,
  formData: FormData,
): Promise<PrepareProductImageActionState> {
  const resolved = await resolveTenantAndPermission("products.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const product = await resolveOwnedProduct(productId, resolved.tenantId);
  if (!product) return { status: "error", message: "Produto não encontrado." };

  const sizeRaw = formData.get("size");
  const size = typeof sizeRaw === "string" ? Number(sizeRaw) : NaN;

  const header = formData.get("header");
  if (!(header instanceof Blob)) {
    return { status: "error", message: "Selecione um arquivo de imagem." };
  }
  const headerBytes = new Uint8Array(await header.arrayBuffer());

  const validated = validateProductImageUploadRequest(size, headerBytes);
  if ("error" in validated) {
    return { status: "error", message: PRODUCT_IMAGE_UPLOAD_REQUEST_ERROR_MESSAGE[validated.error] };
  }

  const supabase = await createSupabaseServerClient();
  const path = buildProductImagePath(resolved.tenantId, productId, validated.mime);

  const { data, error } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .createSignedUploadUrl(path, { upsert: true });

  if (error || !data) {
    return { status: "error", message: "Não foi possível preparar o upload. Tente novamente." };
  }

  return {
    status: "success",
    upload: {
      signedUrl: data.signedUrl,
      token: data.token,
      path: data.path,
      bucket: PRODUCT_IMAGE_BUCKET,
      contentType: validated.mime,
    },
  };
}

/**
 * D11.8 — segunda metade do fluxo: chamada pelo cliente só depois de o
 * upload direto (`uploadToSignedUrl`) ter terminado com sucesso contra o
 * Storage. Recebe o mínimo necessário (productId + o path que o próprio
 * `prepareProductImageUploadAction` gerou) — nunca tenantId/mime, e o
 * `path` recebido NUNCA é confiado como está: `isValidProductImagePath`
 * recomputa os 3 paths possíveis (um por mime permitido) para o
 * tenant/produto já revalidados nesta mesma chamada e exige
 * correspondência exata antes de gravar `products.main_image` ou tocar
 * em qualquer storage.objects.
 *
 * Confirma a existência real do objeto no Storage (client de sessão —
 * SELECT em product-media é público por design, migration
 * 20260817220028) antes de persistir a referência: se o upload direto
 * falhou ou foi interrompido no meio, o produto nunca passa a apontar
 * para um arquivo que não existe. Mesma ordem de segurança de sempre:
 * arquivo novo já confirmado no Storage → só então products.main_image
 * → só então limpeza do objeto antigo.
 */
export async function confirmProductImageUploadAction(
  productId: string,
  path: string,
): Promise<ProductImageActionState> {
  const resolved = await resolveTenantAndPermission("products.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const product = await resolveOwnedProduct(productId, resolved.tenantId);
  if (!product) return { status: "error", message: "Produto não encontrado." };

  if (!isValidProductImagePath(path, resolved.tenantId, productId)) {
    return { status: "error", message: "Caminho de imagem inválido." };
  }

  const supabase = await createSupabaseServerClient();

  const { data: exists, error: existsError } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).exists(path);
  if (existsError || !exists) {
    return { status: "error", message: "Não encontramos o upload. Tente novamente." };
  }

  const { error: updateError } = await supabase
    .from("products")
    .update({ main_image: path })
    .eq("id", productId)
    .eq("tenant_id", resolved.tenantId);

  if (updateError) {
    return { status: "error", message: "Não foi possível salvar a imagem no produto. Tente novamente." };
  }

  // Só agora, com o produto já apontando para o arquivo novo confirmado,
  // é seguro remover o objeto antigo (path diferente = extensão trocada
  // — `upsert` não teria sobrescrito). Best-effort: uma falha aqui deixa
  // só um arquivo órfão inofensivo, nunca uma imagem quebrada.
  if (product.main_image && product.main_image !== path) {
    await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([product.main_image]);
  }

  revalidatePath("/painel/produtos");
  revalidatePath(`/painel/produtos/${productId}/editar`);
  return { status: "success", imagePath: path };
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
