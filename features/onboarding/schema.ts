import { z } from "zod";

/**
 * Allowlist para o único passo de dados desta etapa (arquitetura §10/§18) —
 * campos exatamente iguais aos do formulário `onboarding_sobre_sua_marca`
 * do Stitch. Só `description` é opcional lá ("(OPCIONAL)" no rótulo); os
 * demais são obrigatórios, mesmo sem um atributo `required` explícito no
 * HTML de referência.
 */
export const brandInfoSchema = z.object({
  storeName: z.string().trim().min(2, "Informe o nome da loja").max(120),
  segment: z.enum(["apparel", "electronics", "beauty", "home", "other"], {
    message: "Selecione um segmento",
  }),
  description: z
    .string()
    .trim()
    .max(500, "Máximo de 500 caracteres")
    .optional()
    .transform((v) => (v ? v : undefined)),
  instagram: z
    .string()
    .trim()
    .transform((v) => v.replace(/^@+/, ""))
    .refine((v) => v.length > 0 && v.length <= 60, "Instagram inválido"),
  whatsapp: z
    .string()
    .trim()
    .refine((v) => v.replace(/\D/g, "").length >= 10, "WhatsApp inválido"),
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
});

export type BrandInfoInput = z.infer<typeof brandInfoSchema>;

/**
 * Estado do formulário + `initialBrandInfoState` — vivem aqui, não em
 * `actions.ts`, porque um arquivo `"use server"` só pode exportar
 * funções async (qualquer outro export, como um objeto const, quebra o
 * build — https://nextjs.org/docs/messages/invalid-use-server-value).
 * Mesma separação usada em `features/auth/schema.ts`.
 */
export interface BrandInfoActionState {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Partial<Record<keyof BrandInfoInput, string>>;
}

export const initialBrandInfoState: BrandInfoActionState = { status: "idle" };
