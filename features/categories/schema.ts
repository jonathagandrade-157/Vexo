import { z } from "zod";

/**
 * Allowlist Zod (arquitetura §10/§18; prompt Etapa 7 §13 — mass
 * assignment). `status` não faz parte deste schema de propósito: ativar/
 * desativar é uma ação própria (`toggleCategoryStatusAction`), não um
 * campo livre do formulário de criar/editar.
 */
export const categorySchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da categoria").max(120),
  description: z
    .string()
    .trim()
    .max(500, "Máximo de 500 caracteres")
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export type CategoryInput = z.infer<typeof categorySchema>;

/**
 * Tipo de estado + valor inicial ficam aqui, não em actions.ts: um
 * módulo "use server" só pode exportar funções async (Next.js) — um
 * export não-função (este objeto) quebra o build assim que um Server
 * Component importar de lá também, não só Client Components (achado e
 * corrigido do mesmo jeito na Etapa 5, ver features/auth/sign-out-action.ts).
 */
export interface CategoryActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<keyof CategoryInput, string>>;
}

export const initialCategoryState: CategoryActionState = { status: "idle" };
