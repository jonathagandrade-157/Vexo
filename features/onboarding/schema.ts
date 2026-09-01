import { z } from "zod";

import { BUSINESS_TYPES } from "./step-definitions";

/**
 * Allowlist para a etapa "seu-negocio" do wizard (D12.2) — mesmos campos
 * de sempre (arquitetura §10/§18, formulário `onboarding_sobre_sua_marca`
 * do Stitch) mais `businessType`, novo nesta etapa. Só `description` é
 * opcional; os demais são obrigatórios, mesmo sem um atributo `required`
 * explícito no HTML de referência.
 *
 * `businessType` aceita os 3 valores de `BUSINESS_TYPES` (mesmo CHECK do
 * banco, migration 20260817220093) mesmo só `ecommerce` tendo wizard
 * implementado nesta etapa — a UI (`BrandInfoForm`) é quem restringe o
 * que é de fato selecionável, o schema só valida o allowlist real da
 * coluna.
 */
export const brandInfoSchema = z.object({
  storeName: z.string().trim().min(2, "Informe o nome da loja").max(120),
  businessType: z.enum(BUSINESS_TYPES, { message: "Selecione o tipo do seu negócio" }),
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

/**
 * D12.2 — retorno de `completeOnboardingStepAction` (etapas
 * "orchestrated"/"review"/"publish" — não têm formulário próprio, só um
 * botão "Continuar"). Chamado diretamente (sem `useActionState`), mesmo
 * padrão de `removeProductImageAction`/`confirmProductImageUploadAction`
 * (features/products/actions.ts) — não é dispatch de `<form>`.
 */
export interface OnboardingStepActionState {
  status: "success" | "error";
  message?: string;
}
