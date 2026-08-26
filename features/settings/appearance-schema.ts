import { z } from "zod";

/**
 * Sprint 1 — Fase A (Aparência da loja). Arquivo separado de
 * `features/settings/schema.ts` (que continua sendo só os 6 campos de
 * "Configurações Gerais") — nome/descrição/WhatsApp/Instagram/e-mail
 * nunca são duplicados aqui, só referenciados como leitura na página.
 */

export const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/** Os 5 modelos visuais da Sprint 1 — nomes fixos definidos no relatório da Fase A. Só controla a escolha no painel nesta fase; renderização real na loja pública é uma fase futura. */
export const STOREFRONT_TEMPLATES = ["commerce", "premium", "minimal", "editorial", "fashion"] as const;
export type StorefrontTemplate = (typeof STOREFRONT_TEMPLATES)[number];

export const STOREFRONT_TEMPLATE_LABELS: Record<StorefrontTemplate, string> = {
  commerce: "VEXO Commerce",
  premium: "VEXO Premium",
  minimal: "VEXO Minimal",
  editorial: "VEXO Editorial",
  fashion: "VEXO Fashion",
};

const optionalHexColor = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null))
  .refine((v) => v === null || HEX_COLOR_PATTERN.test(v), { message: "Use o formato #RRGGBB" });

export const storeAppearanceSchema = z.object({
  primaryColor: optionalHexColor,
  secondaryColor: optionalHexColor,
  storefrontTemplate: z.enum(STOREFRONT_TEMPLATES, { message: "Selecione um modelo válido." }),
});

export type StoreAppearanceInput = z.infer<typeof storeAppearanceSchema>;

export interface StoreAppearanceActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<keyof StoreAppearanceInput, string>>;
}

export const initialStoreAppearanceState: StoreAppearanceActionState = { status: "idle" };

/** Estado de `uploadStoreLogoAction`/`removeStoreLogoAction` — arquivo separado do `actions.ts` pelo mesmo motivo de sempre ("use server" só pode exportar função async). */
export interface StoreLogoActionState {
  status: "idle" | "error" | "success";
  message?: string;
  logoPath?: string | null;
}

export const initialStoreLogoState: StoreLogoActionState = { status: "idle" };
