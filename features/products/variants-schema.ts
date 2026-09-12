import { z } from "zod";

import type { ProductOptionValueRow, ProductOptionWithValues, ProductVariantRow } from "./variants-data";

const productOptionNameSchema = z
  .string()
  .trim()
  .min(1, "Informe o nome da opção")
  .max(60, "Máximo de 60 caracteres");

const productOptionValueSchema = z
  .string()
  .trim()
  .min(1, "Informe o valor")
  .max(60, "Máximo de 60 caracteres");

export const createProductOptionSchema = z.object({
  productId: z.uuid("Produto inválido"),
  name: productOptionNameSchema,
});

export const updateProductOptionSchema = z.object({
  optionId: z.uuid("Opção inválida"),
  name: productOptionNameSchema,
});

export const deleteProductOptionSchema = z.object({
  optionId: z.uuid("Opção inválida"),
});

export const reorderProductOptionsSchema = z.object({
  productId: z.uuid("Produto inválido"),
  orderedOptionIds: z
    .array(z.uuid())
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "A lista de opções contém identificadores duplicados.",
    }),
});

export const createProductOptionValueSchema = z.object({
  optionId: z.uuid("Opção inválida"),
  value: productOptionValueSchema,
});

export const updateProductOptionValueSchema = z.object({
  valueId: z.uuid("Valor inválido"),
  value: productOptionValueSchema,
});

export const deleteProductOptionValueSchema = z.object({
  valueId: z.uuid("Valor inválido"),
});

export const reorderProductOptionValuesSchema = z.object({
  optionId: z.uuid("Opção inválida"),
  orderedValueIds: z
    .array(z.uuid())
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "A lista de valores contém identificadores duplicados.",
    }),
});

/** Mesmo padrão de ProductGalleryActionState (features/products/schema.ts): sempre devolve a lista inteira já atualizada, o cliente nunca recalcula/adivinha. */
export interface ProductOptionActionState {
  status: "idle" | "error" | "success";
  message?: string;
  options?: ProductOptionWithValues[];
}

export const initialProductOptionState: ProductOptionActionState = { status: "idle" };

export interface ProductOptionValueActionState {
  status: "idle" | "error" | "success";
  message?: string;
  values?: ProductOptionValueRow[];
}

export const initialProductOptionValueState: ProductOptionValueActionState = { status: "idle" };

// ============================================================
// D20.6 Fase 3.2 — geração/gerenciamento de product_variants
// ============================================================

const emptyToUndefined = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);

const skuSchema = z
  .string()
  .trim()
  .max(64, "Máximo de 64 caracteres")
  .optional()
  .transform((v) => (v ? v : undefined));

/** Mesma regra de productSchema (features/products/schema.ts): preço obrigatório, não-negativo, finito. */
const variantPriceSchema = z.coerce.number({ message: "Preço inválido" }).nonnegative("O preço não pode ser negativo").finite("Preço inválido");

/** Mesma regra de productSchema: opcional, "" vira undefined (nunca 0), não-negativo, finito. */
const variantPromotionalPriceSchema = z.preprocess(
  emptyToUndefined,
  z.coerce
    .number({ message: "Preço promocional inválido" })
    .nonnegative("O preço promocional não pode ser negativo")
    .finite("Preço promocional inválido")
    .optional(),
);

export const generateProductVariantsSchema = z.object({
  productId: z.uuid("Produto inválido"),
});

export const updateProductVariantSchema = z
  .object({
    variantId: z.uuid("Variante inválida"),
    sku: skuSchema,
    price: variantPriceSchema,
    promotionalPrice: variantPromotionalPriceSchema,
  })
  .refine((data) => data.promotionalPrice === undefined || data.promotionalPrice <= data.price, {
    message: "O preço promocional não pode ser maior que o preço normal",
    path: ["promotionalPrice"],
  });

export type UpdateProductVariantInput = z.infer<typeof updateProductVariantSchema>;

export const toggleProductVariantStatusSchema = z.object({
  variantId: z.uuid("Variante inválida"),
  isActive: z.boolean(),
});

/** Mesmo padrão de ProductActionState (features/products/schema.ts): sempre devolve a lista de variantes já atualizada. */
export interface ProductVariantActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<"sku" | "price" | "promotionalPrice", string>>;
  variants?: ProductVariantRow[];
}

export const initialProductVariantState: ProductVariantActionState = { status: "idle" };

/** Retorno de generateProductVariantsAction — além da lista já atualizada, um resumo do que a geração fez (quantas combinações novas, quantas já existiam, quais variantes existentes não correspondem mais a nenhuma combinação válida e precisam de revisão manual — nunca apagadas automaticamente). */
export interface ProductVariantGenerationState {
  status: "idle" | "error" | "success";
  message?: string;
  variants?: ProductVariantRow[];
  createdCount?: number;
  skippedExistingCount?: number;
  reviewVariantIds?: string[];
}

export const initialProductVariantGenerationState: ProductVariantGenerationState = { status: "idle" };
