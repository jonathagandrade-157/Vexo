import { getPublicEnv } from "@/lib/env";

/**
 * Sprint 1 — Fase A. Bucket dedicado à mídia de identidade visual do
 * tenant (`tenant-media`, migration 20260817220076) — nunca reaproveita
 * `product-media` (domínio de conteúdo diferente: loja vs produto).
 *
 * O sniff de bytes mágicos abaixo é uma cópia deliberada de
 * `features/products/image-storage.ts::sniffImageMime` (Etapa 8), não uma
 * importação — esta Sprint não deve tocar nenhum arquivo do domínio de
 * catálogo/produto. Extrair para um módulo compartilhado (`lib/storage/`)
 * fica para quando um terceiro consumidor justificar a refatoração.
 */

export const TENANT_MEDIA_BUCKET = "tenant-media";
export const LOGO_MAX_BYTES = 5 * 1024 * 1024; // 5MB

export type LogoImageMime = "image/jpeg" | "image/png" | "image/webp";

const EXTENSION_BY_MIME: Record<LogoImageMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Detecta o tipo real do arquivo pelos bytes mágicos (assinatura),
 * ignorando qualquer `Content-Type`/extensão declarados pelo cliente.
 * Retorna `null` se não corresponder a nenhum dos 3 formatos permitidos.
 */
export function sniffLogoMime(bytes: Uint8Array): LogoImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Path sempre gerado no servidor, nunca a partir de entrada do cliente.
 * Nome de objeto fixo (`logo.{ext}`) por tenant — 1 arquivo por loja, sem
 * segmento de entidade filha (diferente de produto, que tem 1 imagem por
 * produto). Trocar a logo sobrescreve/reaproveita o mesmo path.
 */
export function buildLogoPath(tenantId: string, mime: LogoImageMime): string {
  return `${tenantId}/logo/logo.${EXTENSION_BY_MIME[mime]}`;
}

/** Bucket é público por design (aparece na vitrine do storefront) — URL determinística, sem round-trip. */
export function getTenantMediaPublicUrl(path: string): string {
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicEnv();
  return `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${TENANT_MEDIA_BUCKET}/${path}`;
}
