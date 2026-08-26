import { z } from "zod";

/**
 * Sprint 1 — Fase C2. Campos exatamente os da auditoria (C1 §13): imagem
 * obrigatória só na criação (tratada fora do Zod — é um `File`, checado
 * na Action, mesmo padrão de `uploadStoreLogoAction`), título e link
 * opcionais, status/ordem sempre presentes.
 */
export const BANNER_STATUSES = ["active", "inactive"] as const;
export type BannerStatus = (typeof BANNER_STATUSES)[number];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null));

export const bannerFieldsSchema = z.object({
  title: optionalText(120),
  linkUrl: optionalText(2048),
  status: z.enum(BANNER_STATUSES),
});

export type BannerFieldsInput = z.infer<typeof bannerFieldsSchema>;

export interface BannerActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<keyof BannerFieldsInput, string>>;
}

export const initialBannerActionState: BannerActionState = { status: "idle" };

export interface StaffBanner {
  id: string;
  image_path: string;
  title: string | null;
  link_url: string | null;
  status: BannerStatus;
  sort_order: number;
}
