import { z } from "zod";

/**
 * Allowlist Zod (arquitetura §10/§18; prompt Etapa 7 §6/§13). Preço vem
 * do form como string — `z.coerce.number()` converte, mas nunca aceita
 * `NaN`/infinito, e a checagem de não-negativo roda no servidor
 * independentemente do `min="0"` do `<input type="number">` (que o
 * client pode ignorar). `promotionalPrice`/`categoryId` tratam string
 * vazia como "não informado" antes de coagir, porque um `<input
 * type="number">` vazio manda `""`, que `z.coerce.number()` sozinho
 * converteria para `0` (errado — "0" é um valor válido diferente de
 * "não preenchido").
 */
const emptyToUndefined = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);

export const productSchema = z
  .object({
    name: z.string().trim().min(2, "Informe o nome do produto").max(180),
    description: z
      .string()
      .trim()
      .max(2000, "Máximo de 2000 caracteres")
      .optional()
      .transform((v) => (v ? v : undefined)),
    price: z.coerce
      .number({ message: "Preço inválido" })
      .nonnegative("O preço não pode ser negativo")
      .finite("Preço inválido"),
    promotionalPrice: z.preprocess(
      emptyToUndefined,
      z.coerce
        .number({ message: "Preço promocional inválido" })
        .nonnegative("O preço promocional não pode ser negativo")
        .finite("Preço promocional inválido")
        .optional(),
    ),
    sku: z
      .string()
      .trim()
      .max(64, "Máximo de 64 caracteres")
      .optional()
      .transform((v) => (v ? v : undefined)),
    categoryId: z.preprocess(emptyToUndefined, z.string().uuid("Categoria inválida").optional()),
  })
  .refine((data) => data.promotionalPrice === undefined || data.promotionalPrice <= data.price, {
    message: "O preço promocional não pode ser maior que o preço normal",
    path: ["promotionalPrice"],
  });

export type ProductInput = z.infer<typeof productSchema>;

export interface ProductActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<keyof ProductInput, string>>;
}

export const initialProductState: ProductActionState = { status: "idle" };
