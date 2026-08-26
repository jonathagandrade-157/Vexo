import { EXTENSION_BY_MIME, LOGO_MAX_BYTES, type LogoImageMime } from "./logo-storage";

/**
 * Sprint 1 — Fase C2. Reaproveita o bucket `tenant-media` (Fase A) e o
 * sniff de bytes mágicos já usado pela logo (`sniffLogoMime`, importado
 * diretamente onde necessário — nunca duplicado, banner e logo já vivem
 * no mesmo domínio `features/settings`, diferente do cuidado de não
 * cruzar com `features/products`). Único acréscimo real: o path tem um
 * segmento a mais (`banners/{banner_id}`) porque é 1:N por tenant, não
 * 1 arquivo fixo como a logo.
 */
export const BANNER_MAX_BYTES = LOGO_MAX_BYTES;
export const MAX_BANNERS_PER_TENANT = 5;

export function buildBannerPath(tenantId: string, bannerId: string, mime: LogoImageMime): string {
  return `${tenantId}/banners/${bannerId}.${EXTENSION_BY_MIME[mime]}`;
}

/** Extraída como função pura só para ser testável (`tests/unit/banner-storage.test.ts`) — `banner-actions.ts` é `"use server"`, fora do alcance direto dos testes deste projeto (mesma limitação de qualquer outra Action aqui). */
export function hasReachedBannerLimit(currentCount: number): boolean {
  return currentCount >= MAX_BANNERS_PER_TENANT;
}

export { TENANT_MEDIA_BUCKET, sniffLogoMime, getTenantMediaPublicUrl, type LogoImageMime } from "./logo-storage";
