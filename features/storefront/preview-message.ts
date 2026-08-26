import type { StorefrontHomeProps } from "@/features/storefront/templates/types";

/**
 * Sprint 1 — Fase B3. Formato único da mensagem trocada, via
 * `postMessage`, entre `app/painel/aparencia/live-preview-frame.tsx` (o
 * `<iframe>` host, no editor) e `app/painel-preview/aparencia/preview-target.tsx`
 * (o alvo, dentro do iframe) — arquivo neutro para os dois lados
 * importarem o mesmo tipo sem um depender de dentro de `app/` do outro.
 */
export const APPEARANCE_PREVIEW_MESSAGE_TYPE = "vexo-appearance-preview";
export const APPEARANCE_PREVIEW_READY_MESSAGE_TYPE = "vexo-appearance-preview-ready";

export interface AppearancePreviewMessage {
  type: typeof APPEARANCE_PREVIEW_MESSAGE_TYPE;
  tenant: StorefrontHomeProps["tenant"];
  categories: StorefrontHomeProps["categories"];
  products: StorefrontHomeProps["products"];
  promotions: StorefrontHomeProps["promotions"];
  banners: StorefrontHomeProps["banners"];
}

export function isAppearancePreviewMessage(data: unknown): data is AppearancePreviewMessage {
  return Boolean(data) && typeof data === "object" && (data as { type?: unknown }).type === APPEARANCE_PREVIEW_MESSAGE_TYPE;
}

export function isAppearancePreviewReadyMessage(data: unknown): boolean {
  return Boolean(data) && typeof data === "object" && (data as { type?: unknown }).type === APPEARANCE_PREVIEW_READY_MESSAGE_TYPE;
}
