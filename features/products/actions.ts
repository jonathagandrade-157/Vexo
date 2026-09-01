"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils/slugify";
import { computeGallerySortOrder, isValidGalleryReorder, moveImageToFront } from "./gallery-logic";
import {
  buildProductGalleryImagePath,
  buildProductImagePath,
  isValidProductGalleryImagePath,
  isValidProductImagePath,
  PRODUCT_GALLERY_MAX_IMAGES,
  PRODUCT_IMAGE_BUCKET,
  validateProductImageUploadRequest,
} from "./image-storage";
import {
  productSchema,
  type PrepareProductGalleryImageActionState,
  type PrepareProductImageActionState,
  type ProductActionState,
  type ProductGalleryActionState,
  type ProductGalleryImage,
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

// ============================================================
// D13.1 — galeria de imagens (product_images). products.main_image
// continua existindo e continua sendo o que o storefront/painel legado
// lê — a partir daqui ele é só um CACHE, sincronizado pelo trigger
// `sync_product_main_image` (migration 20260817220096) toda vez que
// product_images muda. Nenhuma action abaixo grava main_image
// diretamente — só a galeria, o banco cuida do resto. As Actions de
// main_image acima (prepare/confirm/removeProductImageAction) não são
// removidas (compatibilidade — D13.1 §16/§22), mas `ProductForm` deixa
// de as chamar a partir desta etapa (só `ProductGalleryUploader`).
// ============================================================

/** Sempre ordenada por sort_order (a mesma ordem que define a principal — a primeira da lista) — escopada por tenant_id + product_id, nunca por product_id sozinho. */
async function resolveGalleryImages(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
  productId: string,
): Promise<ProductGalleryImage[]> {
  const { data } = await supabase
    .from("product_images")
    .select("id, storage_path, sort_order")
    .eq("tenant_id", tenantId)
    .eq("product_id", productId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  return ((data ?? []) as { id: string; storage_path: string; sort_order: number }[]).map((row) => ({
    id: row.id,
    path: row.storage_path,
    sortOrder: row.sort_order,
  }));
}

/** Grava a ordem já validada (`isValidGalleryReorder`/`moveImageToFront`) — usada tanto por `reorderProductGalleryAction` quanto por `setPrimaryProductGalleryImageAction`, nunca duplicada entre as duas. */
async function applyGalleryOrder(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
  productId: string,
  orderedIds: string[],
): Promise<void> {
  for (const { id, sortOrder } of computeGallerySortOrder(orderedIds)) {
    await supabase
      .from("product_images")
      .update({ sort_order: sortOrder })
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("product_id", productId);
  }
}

/**
 * D13.1 — primeira metade do upload de UMA imagem da galeria. Mesmo
 * checklist de segurança de `prepareProductImageUploadAction` (D11.8):
 * sessão → tenant → permissão (`products.update` — adicionar imagem a
 * um produto já existente é uma atualização dele, nunca criação) →
 * produto pertence ao tenant → limite de `PRODUCT_GALLERY_MAX_IMAGES`
 * → prefixo de bytes validado → signed upload URL.
 *
 * Diferença do fluxo de `main_image`: aqui o servidor gera um `imageId`
 * (UUID) novo a cada chamada — é o que dá identidade própria e estável
 * a cada imagem da galeria (nunca um índice/posição). `upsert: false`
 * (nunca `true`): cada imagem da galeria tem um path único por
 * construção (novo `imageId` sempre), nunca deveria sobrescrever nada.
 */
export async function prepareProductGalleryImageUploadAction(
  productId: string,
  formData: FormData,
): Promise<PrepareProductGalleryImageActionState> {
  const resolved = await resolveTenantAndPermission("products.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const product = await resolveOwnedProduct(productId, resolved.tenantId);
  if (!product) return { status: "error", message: "Produto não encontrado." };

  const supabase = await createSupabaseServerClient();

  const { count } = await supabase
    .from("product_images")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", resolved.tenantId)
    .eq("product_id", productId);

  if ((count ?? 0) >= PRODUCT_GALLERY_MAX_IMAGES) {
    return { status: "error", message: `Limite de ${PRODUCT_GALLERY_MAX_IMAGES} imagens por produto atingido.` };
  }

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

  const imageId = randomUUID();
  const path = buildProductGalleryImagePath(resolved.tenantId, productId, imageId, validated.mime);

  const { data, error } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).createSignedUploadUrl(path, { upsert: false });

  if (error || !data) {
    return { status: "error", message: "Não foi possível preparar o upload. Tente novamente." };
  }

  return {
    status: "success",
    upload: {
      signedUrl: data.signedUrl,
      token: data.token,
      path: data.path,
      imageId,
      bucket: PRODUCT_IMAGE_BUCKET,
      contentType: validated.mime,
    },
  };
}

/**
 * D13.1 — segunda metade: chamada só depois do upload direto
 * (`uploadToSignedUrl`) ter terminado contra o Storage. `imageId`/`path`
 * nunca são confiados como estão — `isValidProductGalleryImagePath`
 * recomputa os 3 paths possíveis (um por mime permitido) para
 * tenant/produto/imageId já revalidados nesta chamada. Confirma
 * existência real do objeto antes de inserir a linha — nenhum registro
 * órfão no banco se o upload falhou ou foi interrompido (D13.1 §8/§17).
 * `sort_order` novo é sempre o maior já existente + 1 (a imagem nova
 * entra no fim da fila — nunca vira principal sozinha, o lojista decide
 * isso explicitamente com `setPrimaryProductGalleryImageAction`).
 */
export async function confirmProductGalleryImageUploadAction(
  productId: string,
  imageId: string,
  path: string,
): Promise<ProductGalleryActionState> {
  const resolved = await resolveTenantAndPermission("products.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const product = await resolveOwnedProduct(productId, resolved.tenantId);
  if (!product) return { status: "error", message: "Produto não encontrado." };

  if (!isValidProductGalleryImagePath(path, resolved.tenantId, productId, imageId)) {
    return { status: "error", message: "Caminho de imagem inválido." };
  }

  const supabase = await createSupabaseServerClient();

  const { data: exists, error: existsError } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).exists(path);
  if (existsError || !exists) {
    return { status: "error", message: "Não encontramos o upload. Tente novamente." };
  }

  const currentImages = await resolveGalleryImages(supabase, resolved.tenantId, productId);
  if (currentImages.length >= PRODUCT_GALLERY_MAX_IMAGES) {
    // Corrida rara (duas abas preparando upload quase juntas, ambas sob
    // o limite no momento do prepare): só a primeira confirmação entra.
    // Pior caso é um objeto órfão no Storage, nunca uma galeria acima
    // do limite — mesma filosofia do resto do arquivo.
    return { status: "error", message: `Limite de ${PRODUCT_GALLERY_MAX_IMAGES} imagens por produto atingido.` };
  }
  const nextSortOrder = currentImages.length === 0 ? 0 : Math.max(...currentImages.map((i) => i.sortOrder)) + 1;

  const { error: insertError } = await supabase.from("product_images").insert({
    id: imageId,
    tenant_id: resolved.tenantId,
    product_id: productId,
    storage_path: path,
    sort_order: nextSortOrder,
  });

  if (insertError) {
    return { status: "error", message: "Não foi possível salvar a imagem no produto. Tente novamente." };
  }

  revalidatePath("/painel/produtos");
  revalidatePath(`/painel/produtos/${productId}/editar`);
  const images = await resolveGalleryImages(supabase, resolved.tenantId, productId);
  return { status: "success", images };
}

/**
 * D13.1 — remove uma imagem da galeria. Ordem de segurança (§11): remove
 * a REFERÊNCIA primeiro — o trigger `sync_product_main_image` já
 * recalcula `products.main_image` (para a próxima imagem da fila, ou
 * `NULL` se a galeria ficar vazia) dentro da mesma escrita, nunca deixa
 * o produto apontando para um arquivo removido. Só depois remove o
 * objeto do Storage, best-effort — falhar aqui deixa só um arquivo
 * órfão inofensivo, nunca uma imagem quebrada (mesma filosofia de
 * `confirmProductImageUploadAction`).
 */
export async function deleteProductGalleryImageAction(
  productId: string,
  imageId: string,
): Promise<ProductGalleryActionState> {
  const resolved = await resolveTenantAndPermission("products.delete");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const product = await resolveOwnedProduct(productId, resolved.tenantId);
  if (!product) return { status: "error", message: "Produto não encontrado." };

  const supabase = await createSupabaseServerClient();

  const { data: row } = await supabase
    .from("product_images")
    .select("storage_path")
    .eq("id", imageId)
    .eq("tenant_id", resolved.tenantId)
    .eq("product_id", productId)
    .maybeSingle();

  if (!row) return { status: "error", message: "Imagem não encontrada." };

  const { error: deleteError, count } = await supabase
    .from("product_images")
    .delete({ count: "exact" })
    .eq("id", imageId)
    .eq("tenant_id", resolved.tenantId)
    .eq("product_id", productId);

  if (deleteError || !count) {
    return { status: "error", message: "Não foi possível remover a imagem. Tente novamente." };
  }

  await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([row.storage_path]);

  revalidatePath("/painel/produtos");
  revalidatePath(`/painel/produtos/${productId}/editar`);
  const images = await resolveGalleryImages(supabase, resolved.tenantId, productId);
  return { status: "success", images };
}

/**
 * D13.1 — reordena a galeria inteira. `orderedImageIds` (vindo do
 * cliente) nunca é confiado como está: `isValidGalleryReorder` exige que
 * seja EXATAMENTE uma permutação dos ids que já pertencem a este produto
 * (mesmo tamanho, mesmos ids, sem duplicata, sem id de outro
 * produto/tenant "inserido" no meio) antes de qualquer escrita. A
 * posição no array — nunca um valor de sort_order enviado por item —
 * decide o `sort_order` final (`computeGallerySortOrder`).
 */
export async function reorderProductGalleryAction(
  productId: string,
  orderedImageIds: string[],
): Promise<ProductGalleryActionState> {
  const resolved = await resolveTenantAndPermission("products.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const product = await resolveOwnedProduct(productId, resolved.tenantId);
  if (!product) return { status: "error", message: "Produto não encontrado." };

  const supabase = await createSupabaseServerClient();
  const currentImages = await resolveGalleryImages(supabase, resolved.tenantId, productId);
  const currentIds = currentImages.map((i) => i.id);

  if (!isValidGalleryReorder(currentIds, orderedImageIds)) {
    return { status: "error", message: "Ordem inválida." };
  }

  await applyGalleryOrder(supabase, resolved.tenantId, productId, orderedImageIds);

  revalidatePath("/painel/produtos");
  revalidatePath(`/painel/produtos/${productId}/editar`);
  const images = await resolveGalleryImages(supabase, resolved.tenantId, productId);
  return { status: "success", images };
}

/**
 * D13.1 — define uma imagem como principal: move `imageId` para o início
 * da lista (`moveImageToFront`), preservando a ordem relativa das
 * demais, e regrava `sort_order` de todas (`applyGalleryOrder`) — o
 * trigger `sync_product_main_image` então atualiza `products.main_image`
 * para o path desta imagem. Nunca uma coluna `is_primary` própria (ver
 * comentário da migration 20260817220096).
 */
export async function setPrimaryProductGalleryImageAction(
  productId: string,
  imageId: string,
): Promise<ProductGalleryActionState> {
  const resolved = await resolveTenantAndPermission("products.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const product = await resolveOwnedProduct(productId, resolved.tenantId);
  if (!product) return { status: "error", message: "Produto não encontrado." };

  const supabase = await createSupabaseServerClient();
  const currentImages = await resolveGalleryImages(supabase, resolved.tenantId, productId);
  const currentIds = currentImages.map((i) => i.id);

  const reordered = moveImageToFront(currentIds, imageId);
  if (!reordered) return { status: "error", message: "Imagem não encontrada." };

  await applyGalleryOrder(supabase, resolved.tenantId, productId, reordered);

  revalidatePath("/painel/produtos");
  revalidatePath(`/painel/produtos/${productId}/editar`);
  const images = await resolveGalleryImages(supabase, resolved.tenantId, productId);
  return { status: "success", images };
}
