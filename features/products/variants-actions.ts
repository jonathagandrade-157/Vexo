"use server";

import { revalidatePath } from "next/cache";

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { computeGallerySortOrder, isValidGalleryReorder } from "./gallery-logic";
import { diffVariantCombinations, generateCombinations, MAX_OPTIONS_PER_PRODUCT, MAX_VALUES_PER_OPTION, MAX_VARIANTS_PER_PRODUCT } from "./variant-combinations";
import {
  getOptionValues,
  getProductOptionsWithValues,
  getProductPrice,
  getProductVariants,
  listOptionIdsForProduct,
  listValueIdsForOption,
  resolveOwnedOption,
  resolveOwnedOptionValue,
  resolveOwnedProduct,
  resolveOwnedVariant,
} from "./variants-data";
import {
  createProductOptionSchema,
  createProductOptionValueSchema,
  deleteProductOptionSchema,
  deleteProductOptionValueSchema,
  generateProductVariantsSchema,
  reorderProductOptionsSchema,
  reorderProductOptionValuesSchema,
  toggleProductVariantStatusSchema,
  updateProductOptionSchema,
  updateProductOptionValueSchema,
  updateProductVariantSchema,
  type ProductOptionActionState,
  type ProductOptionValueActionState,
  type ProductVariantActionState,
  type ProductVariantGenerationState,
} from "./variants-schema";

/** Mesmo checklist/padrão de features/categories/actions.ts e features/products/actions.ts — duplicado de propósito (cada domínio checa a permission key própria), nunca compartilhado/exportado. */
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

// ============================================================
// Opções (product_options)
// ============================================================

export async function createProductOptionAction(productId: string, name: string): Promise<ProductOptionActionState> {
  const parsed = createProductOptionSchema.safeParse({ productId, name });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const resolved = await resolveTenantAndPermission("products.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();

  const product = await resolveOwnedProduct(supabase, resolved.tenantId, parsed.data.productId);
  if (!product) return { status: "error", message: "Produto não encontrado." };

  const currentIds = await listOptionIdsForProduct(supabase, resolved.tenantId, parsed.data.productId);

  const { error } = await supabase.from("product_options").insert({
    tenant_id: resolved.tenantId,
    product_id: parsed.data.productId,
    name: parsed.data.name,
    position: currentIds.length,
  });

  if (error) {
    if (error.code === "23505") {
      return { status: "error", message: "Já existe uma opção com esse nome neste produto." };
    }
    return { status: "error", message: "Não foi possível criar a opção. Tente novamente." };
  }

  revalidatePath(`/painel/produtos/${parsed.data.productId}/editar`);
  const options = await getProductOptionsWithValues(supabase, resolved.tenantId, parsed.data.productId);
  return { status: "success", options };
}

export async function updateProductOptionAction(optionId: string, name: string): Promise<ProductOptionActionState> {
  const parsed = updateProductOptionSchema.safeParse({ optionId, name });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const resolved = await resolveTenantAndPermission("products.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();

  const option = await resolveOwnedOption(supabase, resolved.tenantId, parsed.data.optionId);
  if (!option) return { status: "error", message: "Opção não encontrada." };

  const { error } = await supabase
    .from("product_options")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.optionId)
    .eq("tenant_id", resolved.tenantId);

  if (error) {
    if (error.code === "23505") {
      return { status: "error", message: "Já existe uma opção com esse nome neste produto." };
    }
    return { status: "error", message: "Não foi possível salvar a opção. Tente novamente." };
  }

  revalidatePath(`/painel/produtos/${option.productId}/editar`);
  const options = await getProductOptionsWithValues(supabase, resolved.tenantId, option.productId);
  return { status: "success", options };
}

export async function deleteProductOptionAction(optionId: string): Promise<ProductOptionActionState> {
  const parsed = deleteProductOptionSchema.safeParse({ optionId });
  if (!parsed.success) {
    return { status: "error", message: "Opção inválida." };
  }

  const resolved = await resolveTenantAndPermission("products.delete");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();

  const option = await resolveOwnedOption(supabase, resolved.tenantId, parsed.data.optionId);
  if (!option) return { status: "error", message: "Opção não encontrada." };

  const { error } = await supabase
    .from("product_options")
    .delete()
    .eq("id", parsed.data.optionId)
    .eq("tenant_id", resolved.tenantId);

  if (error) {
    if (error.code === "23503") {
      return {
        status: "error",
        message: "Não é possível excluir: esta opção está em uso por uma ou mais variantes do produto.",
      };
    }
    return { status: "error", message: "Não foi possível excluir a opção. Tente novamente." };
  }

  revalidatePath(`/painel/produtos/${option.productId}/editar`);
  const options = await getProductOptionsWithValues(supabase, resolved.tenantId, option.productId);
  return { status: "success", options };
}

/**
 * `orderedOptionIds` (vindo do cliente) nunca é confiado como está —
 * `isValidGalleryReorder` (reaproveitada de gallery-logic.ts, genérica
 * sobre string[]) exige que seja EXATAMENTE uma permutação dos ids que já
 * pertencem a este produto (mesma tamanho, mesmos ids, sem duplicata, sem
 * id de outro produto/tenant) antes de qualquer escrita — `currentIds`
 * sempre vem de uma query escopada por tenant_id + product_id.
 */
export async function reorderProductOptionsAction(
  productId: string,
  orderedOptionIds: string[],
): Promise<ProductOptionActionState> {
  const parsed = reorderProductOptionsSchema.safeParse({ productId, orderedOptionIds });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Ordem inválida." };
  }

  const resolved = await resolveTenantAndPermission("products.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();

  const product = await resolveOwnedProduct(supabase, resolved.tenantId, parsed.data.productId);
  if (!product) return { status: "error", message: "Produto não encontrado." };

  const currentIds = await listOptionIdsForProduct(supabase, resolved.tenantId, parsed.data.productId);
  if (!isValidGalleryReorder(currentIds, parsed.data.orderedOptionIds)) {
    return { status: "error", message: "Ordem inválida." };
  }

  for (const { id, sortOrder } of computeGallerySortOrder(parsed.data.orderedOptionIds)) {
    await supabase
      .from("product_options")
      .update({ position: sortOrder })
      .eq("id", id)
      .eq("tenant_id", resolved.tenantId)
      .eq("product_id", parsed.data.productId);
  }

  revalidatePath(`/painel/produtos/${parsed.data.productId}/editar`);
  const options = await getProductOptionsWithValues(supabase, resolved.tenantId, parsed.data.productId);
  return { status: "success", options };
}

// ============================================================
// Valores (product_option_values)
// ============================================================

export async function createProductOptionValueAction(
  optionId: string,
  value: string,
): Promise<ProductOptionValueActionState> {
  const parsed = createProductOptionValueSchema.safeParse({ optionId, value });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const resolved = await resolveTenantAndPermission("products.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();

  const option = await resolveOwnedOption(supabase, resolved.tenantId, parsed.data.optionId);
  if (!option) return { status: "error", message: "Opção não encontrada." };

  const currentIds = await listValueIdsForOption(supabase, resolved.tenantId, parsed.data.optionId);

  const { error } = await supabase.from("product_option_values").insert({
    tenant_id: resolved.tenantId,
    product_option_id: parsed.data.optionId,
    value: parsed.data.value,
    position: currentIds.length,
  });

  if (error) {
    if (error.code === "23505") {
      return { status: "error", message: "Já existe um valor igual a esse nesta opção." };
    }
    return { status: "error", message: "Não foi possível criar o valor. Tente novamente." };
  }

  revalidatePath(`/painel/produtos/${option.productId}/editar`);
  const values = await getOptionValues(supabase, resolved.tenantId, parsed.data.optionId);
  return { status: "success", values };
}

export async function updateProductOptionValueAction(
  valueId: string,
  value: string,
): Promise<ProductOptionValueActionState> {
  const parsed = updateProductOptionValueSchema.safeParse({ valueId, value });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const resolved = await resolveTenantAndPermission("products.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();

  const optionValue = await resolveOwnedOptionValue(supabase, resolved.tenantId, parsed.data.valueId);
  if (!optionValue) return { status: "error", message: "Valor não encontrado." };

  const { error } = await supabase
    .from("product_option_values")
    .update({ value: parsed.data.value })
    .eq("id", parsed.data.valueId)
    .eq("tenant_id", resolved.tenantId);

  if (error) {
    if (error.code === "23505") {
      return { status: "error", message: "Já existe um valor igual a esse nesta opção." };
    }
    return { status: "error", message: "Não foi possível salvar o valor. Tente novamente." };
  }

  revalidatePath(`/painel/produtos/${optionValue.productId}/editar`);
  const values = await getOptionValues(supabase, resolved.tenantId, optionValue.optionId);
  return { status: "success", values };
}

export async function deleteProductOptionValueAction(valueId: string): Promise<ProductOptionValueActionState> {
  const parsed = deleteProductOptionValueSchema.safeParse({ valueId });
  if (!parsed.success) {
    return { status: "error", message: "Valor inválido." };
  }

  const resolved = await resolveTenantAndPermission("products.delete");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();

  const optionValue = await resolveOwnedOptionValue(supabase, resolved.tenantId, parsed.data.valueId);
  if (!optionValue) return { status: "error", message: "Valor não encontrado." };

  const { error } = await supabase
    .from("product_option_values")
    .delete()
    .eq("id", parsed.data.valueId)
    .eq("tenant_id", resolved.tenantId);

  if (error) {
    if (error.code === "23503") {
      return {
        status: "error",
        message: "Não é possível excluir: este valor está em uso por uma ou mais variantes do produto.",
      };
    }
    return { status: "error", message: "Não foi possível excluir o valor. Tente novamente." };
  }

  revalidatePath(`/painel/produtos/${optionValue.productId}/editar`);
  const values = await getOptionValues(supabase, resolved.tenantId, optionValue.optionId);
  return { status: "success", values };
}

/** Mesma validação de reorderProductOptionsAction, um nível mais fundo (escopado por optionId em vez de productId). */
export async function reorderProductOptionValuesAction(
  optionId: string,
  orderedValueIds: string[],
): Promise<ProductOptionValueActionState> {
  const parsed = reorderProductOptionValuesSchema.safeParse({ optionId, orderedValueIds });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Ordem inválida." };
  }

  const resolved = await resolveTenantAndPermission("products.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();

  const option = await resolveOwnedOption(supabase, resolved.tenantId, parsed.data.optionId);
  if (!option) return { status: "error", message: "Opção não encontrada." };

  const currentIds = await listValueIdsForOption(supabase, resolved.tenantId, parsed.data.optionId);
  if (!isValidGalleryReorder(currentIds, parsed.data.orderedValueIds)) {
    return { status: "error", message: "Ordem inválida." };
  }

  for (const { id, sortOrder } of computeGallerySortOrder(parsed.data.orderedValueIds)) {
    await supabase
      .from("product_option_values")
      .update({ position: sortOrder })
      .eq("id", id)
      .eq("tenant_id", resolved.tenantId)
      .eq("product_option_id", parsed.data.optionId);
  }

  revalidatePath(`/painel/produtos/${option.productId}/editar`);
  const values = await getOptionValues(supabase, resolved.tenantId, parsed.data.optionId);
  return { status: "success", values };
}

// ============================================================
// D20.6 Fase 3.2 — geração/gerenciamento de variantes (product_variants)
// ============================================================

/**
 * Gera/sincroniza as variantes de um produto a partir do produto
 * cartesiano de suas opções+valores REAIS (lidos aqui, nunca aceitos do
 * cliente — `generateProductVariantsSchema` só recebe `productId`).
 * Idempotente: rodar de novo nunca duplica combinações já existentes
 * (`diffVariantCombinations` só cria o que falta) e nunca apaga/altera uma
 * variante existente cuja combinação continue válida. Combinações que
 * deixaram de ser válidas (um valor usado por elas foi excluído, por
 * exemplo) são só sinalizadas em `reviewVariantIds` — nunca apagadas
 * automaticamente (dado comercial: SKU/preço já podem estar em uso em
 * pedidos passados, mesmo sem D20.6 ainda ler isso).
 */
export async function generateProductVariantsAction(productId: string): Promise<ProductVariantGenerationState> {
  const parsed = generateProductVariantsSchema.safeParse({ productId });
  if (!parsed.success) {
    return { status: "error", message: "Produto inválido." };
  }

  const resolved = await resolveTenantAndPermission("products.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();

  const product = await resolveOwnedProduct(supabase, resolved.tenantId, parsed.data.productId);
  if (!product) return { status: "error", message: "Produto não encontrado." };

  const options = await getProductOptionsWithValues(supabase, resolved.tenantId, parsed.data.productId);

  if (options.length === 0) {
    return { status: "error", message: "Cadastre ao menos uma opção com valores antes de gerar combinações." };
  }
  if (options.length > MAX_OPTIONS_PER_PRODUCT) {
    return {
      status: "error",
      message: `Este produto tem mais de ${MAX_OPTIONS_PER_PRODUCT} opções — o limite é ${MAX_OPTIONS_PER_PRODUCT} opções por produto.`,
    };
  }

  const optionWithoutValues = options.find((option) => option.values.length === 0);
  if (optionWithoutValues) {
    return { status: "error", message: `A opção "${optionWithoutValues.name}" não possui valores cadastrados.` };
  }

  const oversizedOption = options.find((option) => option.values.length > MAX_VALUES_PER_OPTION);
  if (oversizedOption) {
    return {
      status: "error",
      message: `A opção "${oversizedOption.name}" tem mais de ${MAX_VALUES_PER_OPTION} valores — o limite é ${MAX_VALUES_PER_OPTION} valores por opção.`,
    };
  }

  const combinations = generateCombinations(
    options.map((option) => ({ optionId: option.id, valueIds: option.values.map((value) => value.id) })),
  );

  if (combinations.length > MAX_VARIANTS_PER_PRODUCT) {
    return {
      status: "error",
      message: `Essa combinação geraria ${combinations.length} variantes — o limite é ${MAX_VARIANTS_PER_PRODUCT} variantes por produto. Reduza o número de opções ou valores.`,
    };
  }

  const existingVariants = await getProductVariants(supabase, resolved.tenantId, parsed.data.productId);
  const diff = diffVariantCombinations(
    combinations,
    existingVariants.map((variant) => ({ id: variant.id, optionValueIds: variant.optionValueIds })),
  );

  if (diff.toCreate.length === 0) {
    return {
      status: "success",
      message:
        diff.reviewVariantIds.length > 0
          ? "Nenhuma combinação nova para gerar. Algumas variantes existentes não correspondem mais às opções/valores atuais — revise-as."
          : "Nenhuma combinação nova para gerar — todas já existem.",
      variants: existingVariants,
      createdCount: 0,
      skippedExistingCount: 0,
      reviewVariantIds: diff.reviewVariantIds,
    };
  }

  const defaultPrice = await getProductPrice(supabase, resolved.tenantId, parsed.data.productId);
  if (defaultPrice === null) return { status: "error", message: "Produto não encontrado." };

  let createdCount = 0;
  let skippedExistingCount = 0;
  for (const combination of diff.toCreate) {
    const { error } = await supabase.from("product_variants").insert({
      tenant_id: resolved.tenantId,
      product_id: parsed.data.productId,
      price: defaultPrice,
      option_value_ids: combination,
    });
    if (error) {
      // 23505 = outra requisição concorrente já criou exatamente esta
      // combinação entre a leitura acima e este INSERT (prompt Fase 3.2
      // "CONCORRÊNCIA") — a constraint do banco (product_variants_
      // product_combination_unique) é a autoridade final, nunca tratado
      // como falha da geração como um todo.
      if (error.code === "23505") {
        skippedExistingCount += 1;
        continue;
      }
      return { status: "error", message: "Não foi possível gerar todas as combinações. Tente novamente." };
    }
    createdCount += 1;
  }

  revalidatePath(`/painel/produtos/${parsed.data.productId}/editar`);
  const variants = await getProductVariants(supabase, resolved.tenantId, parsed.data.productId);

  return {
    status: "success",
    message: `${createdCount} combinação(ões) gerada(s).`,
    variants,
    createdCount,
    skippedExistingCount,
    reviewVariantIds: diff.reviewVariantIds,
  };
}

/**
 * Atualiza SKU/preço/preço promocional de uma variante já existente —
 * nunca cria/apaga uma variante, nunca altera option_value_ids (a
 * combinação é imutável após a criação nesta fase; mudar a combinação de
 * uma variante existente é geração, não edição).
 */
export async function updateProductVariantAction(
  variantId: string,
  input: { sku?: string; price: number; promotionalPrice?: number },
): Promise<ProductVariantActionState> {
  const parsed = updateProductVariantSchema.safeParse({ variantId, ...input });
  if (!parsed.success) {
    const fieldErrors: ProductVariantActionState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === "sku" || key === "price" || key === "promotionalPrice") fieldErrors[key] ??= issue.message;
    }
    return { status: "error", fieldErrors, message: "Verifique os campos destacados." };
  }

  const resolved = await resolveTenantAndPermission("products.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();

  const variant = await resolveOwnedVariant(supabase, resolved.tenantId, parsed.data.variantId);
  if (!variant) return { status: "error", message: "Variante não encontrada." };

  const { error } = await supabase
    .from("product_variants")
    .update({
      sku: parsed.data.sku ?? null,
      price: parsed.data.price,
      promotional_price: parsed.data.promotionalPrice ?? null,
    })
    .eq("id", parsed.data.variantId)
    .eq("tenant_id", resolved.tenantId);

  if (error) {
    if (error.code === "23505") {
      return {
        status: "error",
        fieldErrors: { sku: "Já existe uma variante com esse SKU nesta loja." },
        message: "Verifique os campos destacados.",
      };
    }
    return { status: "error", message: "Não foi possível salvar a variante. Tente novamente." };
  }

  revalidatePath(`/painel/produtos/${variant.productId}/editar`);
  const variants = await getProductVariants(supabase, resolved.tenantId, variant.productId);
  return { status: "success", variants };
}

/**
 * Ativa/desativa uma variante — nunca exclui. Uma variante inativa deixa
 * de ser "disponível para venda" só no sentido de dado de backend nesta
 * fase (o storefront/carrinho/checkout não são tocados aqui, prompt Fase
 * 3.2 "NÃO FAZER NESTA FASE"). Exclusão individual/em massa deliberadamente
 * não implementada — ver relatório final ("Pendências").
 */
export async function toggleProductVariantStatusAction(
  variantId: string,
  isActive: boolean,
): Promise<ProductVariantActionState> {
  const parsed = toggleProductVariantStatusSchema.safeParse({ variantId, isActive });
  if (!parsed.success) {
    return { status: "error", message: "Variante inválida." };
  }

  const resolved = await resolveTenantAndPermission("products.update");
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();

  const variant = await resolveOwnedVariant(supabase, resolved.tenantId, parsed.data.variantId);
  if (!variant) return { status: "error", message: "Variante não encontrada." };

  const { error } = await supabase
    .from("product_variants")
    .update({ is_active: parsed.data.isActive })
    .eq("id", parsed.data.variantId)
    .eq("tenant_id", resolved.tenantId);

  if (error) {
    return { status: "error", message: "Não foi possível atualizar o status. Tente novamente." };
  }

  revalidatePath(`/painel/produtos/${variant.productId}/editar`);
  const variants = await getProductVariants(supabase, resolved.tenantId, variant.productId);
  return { status: "success", variants };
}
