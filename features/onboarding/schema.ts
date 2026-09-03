import { z } from "zod";

import { BUSINESS_TYPES } from "./step-definitions";

/**
 * Allowlist para a etapa "seu-negocio" do wizard (D12.2). Mesmos campos de
 * sempre (arquitetura §10/§18, formulário `onboarding_sobre_sua_marca` do
 * Stitch). Só `description` é opcional; os demais são obrigatórios, mesmo
 * sem um atributo `required` explícito no HTML de referência.
 *
 * D15.1.1 — `businessType` saiu deste schema/formulário: agora é
 * escolhido antes, na nova etapa "segmento" (`businessTypeSchema` abaixo),
 * que grava `tenants.business_type` sozinha. `saveBrandInfoAction`
 * (features/onboarding/actions.ts) passa a assumir esse campo já
 * definido, nunca mais o recebendo por este formulário.
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

/**
 * D15.1.1 — etapa "segmento", nova primeira etapa do wizard. Aceita os 3
 * valores de `BUSINESS_TYPES` (mesmo CHECK do banco, migration
 * 20260817220093) mesmo só `ecommerce` tendo wizard implementado — a UI
 * (`BusinessTypeForm`) e a Server Action (`isSelectableBusinessType`,
 * `features/onboarding/business-type-choices.ts`) são quem restringem o
 * que é de fato selecionável hoje; o schema só valida o allowlist real da
 * coluna, mesmo padrão de `brandInfoSchema` antes desta mudança.
 */
export const businessTypeSchema = z.object({
  businessType: z.enum(BUSINESS_TYPES, { message: "Selecione o tipo do seu negócio" }),
});

export type BusinessTypeInput = z.infer<typeof businessTypeSchema>;

export interface BusinessTypeActionState {
  status: "idle" | "error";
  message?: string;
}

export const initialBusinessTypeState: BusinessTypeActionState = { status: "idle" };
