import { z } from "zod";

/** Mesmo helper de features/checkout/schema.ts — campo opcional vazio no formulário vira `undefined`, não string vazia. */
const emptyToUndefined = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);

/**
 * Mesma forma de features/categories/schema.ts (allowlist Zod, arquitetura
 * §10/§18). `enabled` fica de fora deste schema — é alternado por uma ação
 * própria (mesmo padrão de toggleCategoryStatusAction), não um campo livre
 * do formulário de origem.
 */
export const shippingSettingsSchema = z.object({
  originZip: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .transform((v) => v.replace(/\D/g, ""))
      .refine((v) => v.length === 8, "CEP inválido")
      .optional(),
  ),
});

export type ShippingSettingsInput = z.infer<typeof shippingSettingsSchema>;

export interface ShippingSettingsActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<keyof ShippingSettingsInput, string>>;
}

export const initialShippingSettingsState: ShippingSettingsActionState = { status: "idle" };

/**
 * `status`/`sortOrder` de exibição ficam fora deste schema de criação/
 * edição — ativar/desativar é ação própria (mesmo padrão de categorias);
 * `sortOrder` é opcional e só reordena a exibição, nunca obrigatório.
 */
export const shippingMethodSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da modalidade").max(80),
  price: z.coerce.number().min(0, "O preço não pode ser negativo").max(99999.99, "Preço inválido"),
  estimatedDays: z.preprocess(emptyToUndefined, z.coerce.number().int().positive("Prazo inválido").optional()),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional().default(0),
});

export type ShippingMethodInput = z.infer<typeof shippingMethodSchema>;

export interface ShippingMethodActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<keyof ShippingMethodInput, string>>;
}

export const initialShippingMethodState: ShippingMethodActionState = { status: "idle" };
