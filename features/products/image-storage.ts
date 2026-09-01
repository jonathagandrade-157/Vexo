import { getPublicEnv } from "@/lib/env";

/**
 * Foundation puramente funcional (sem I/O) para upload de imagem de
 * produto — Etapa 8. Bucket/limite/allow-list já estavam documentados na
 * arquitetura (`vexo-arquitetura-tecnica.md` §9.1/§9.3); não inventados
 * agora. Sem `sharp`/pipeline de reprocessamento nesta etapa (binário
 * nativo, risco de build neste ambiente) — mitigação parcial documentada
 * no relatório final: allow-list fechada + sniff de bytes mágicos reais
 * (nunca o `Content-Type` declarado pelo browser nem a extensão do nome
 * do arquivo) + nome do objeto sempre gerado no servidor.
 */

export const PRODUCT_IMAGE_BUCKET = "product-media";
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5MB (arquitetura §9.3)

export type ProductImageMime = "image/jpeg" | "image/png" | "image/webp";

const EXTENSION_BY_MIME: Record<ProductImageMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Detecta o tipo real do arquivo pelos bytes mágicos (assinatura),
 * ignorando qualquer `Content-Type`/extensão declarados pelo cliente.
 * Retorna `null` se não corresponder a nenhum dos 3 formatos permitidos
 * (inclui SVG, PDF, HTML, executáveis, etc. — tudo rejeitado).
 */
export function sniffImageMime(bytes: Uint8Array): ProductImageMime | null {
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
 * Path sempre gerado no servidor, nunca a partir de entrada do cliente
 * (arquitetura §9.2). Nome de objeto fixo (`main.{ext}`) por produto —
 * uma troca de imagem sobrescreve/reaproveita o mesmo path (depois de
 * remover o objeto antigo se a extensão mudou), o que elimina acúmulo de
 * arquivo órfão por troca de formato sem precisar de job de limpeza.
 */
export function buildProductImagePath(tenantId: string, productId: string, mime: ProductImageMime): string {
  return `${tenantId}/products/${productId}/main.${EXTENSION_BY_MIME[mime]}`;
}

/** Bucket é público por design (vitrine do storefront) — URL determinística, sem round-trip. */
export function getProductImagePublicUrl(path: string): string {
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicEnv();
  return `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/${path}`;
}

/**
 * D11.8 — validação pura do pedido de upload direto (tamanho + bytes
 * mágicos do prefixo enviado ao `prepareProductImageUploadAction`),
 * extraída pelo mesmo motivo de sempre neste arquivo (testável sem
 * infraestrutura de componente/rede — só o `sniffImageMime`/
 * `PRODUCT_IMAGE_MAX_BYTES` já existentes, reaproveitados, nunca
 * duplicados). `size` vem do `File.size` do browser (não confiável
 * sozinho — só bytes reais gravados no Storage é que valem, e o bucket
 * `product-media` já impõe o limite de 5MB do lado do servidor via
 * `file_size_limit`, migration 20260817220028); esta função só existe
 * para dar um erro rápido e amigável antes de gerar uma signed URL à toa.
 */
export type ProductImageUploadRequestError = "empty" | "too_large" | "unsupported_mime";

export function validateProductImageUploadRequest(
  size: number,
  headerBytes: Uint8Array,
): { mime: ProductImageMime } | { error: ProductImageUploadRequestError } {
  if (!Number.isFinite(size) || size <= 0) return { error: "empty" };
  if (size > PRODUCT_IMAGE_MAX_BYTES) return { error: "too_large" };
  const mime = sniffImageMime(headerBytes);
  if (!mime) return { error: "unsupported_mime" };
  return { mime };
}

const ALL_PRODUCT_IMAGE_MIMES: readonly ProductImageMime[] = ["image/jpeg", "image/png", "image/webp"];

/**
 * D11.8 — o cliente devolve o `path` recebido de `createSignedUploadUrl`
 * ao confirmar o upload, mas o servidor nunca confia nele: recomputa,
 * para o tenant/produto já validados via sessão + posse (nunca a partir
 * de entrada do cliente), os únicos 3 paths possíveis — um por mime
 * permitido — e exige que o path recebido seja exatamente um deles. Isso
 * é o que impede um cliente de apontar `products.main_image` para um
 * path arbitrário (de outro produto, outro tenant, ou fora do padrão
 * `{tenant_id}/products/{product_id}/main.{ext}`).
 */
export function isValidProductImagePath(path: string, tenantId: string, productId: string): boolean {
  return ALL_PRODUCT_IMAGE_MIMES.some((mime) => buildProductImagePath(tenantId, productId, mime) === path);
}

/**
 * D13.1 — limite de imagens por produto na galeria. Não existe nenhum
 * `limit_key` de plano equivalente hoje (`plan_limits`, migration
 * 20260817220058, só tem chaves de produtos/categorias — confirmado por
 * busca antes de inventar) — por instrução explícita desta etapa, uma
 * constante interna aqui, documentada, sem criar sistema de billing
 * novo. Puramente um teto de bom senso (evitar abuso/objetos
 * ilimitados no Storage), não uma feature comercial.
 */
export const PRODUCT_GALLERY_MAX_IMAGES = 8;

/**
 * D13.1 — path de uma imagem da GALERIA, distinto do path de
 * `main_image` (`buildProductImagePath`, `main.{ext}` fixo por
 * produto): `imageId` dá identidade própria e estável a cada imagem —
 * nunca um índice/posição (uma imagem não muda de identidade ao ser
 * reordenada). Sempre gerado no servidor
 * (`prepareProductGalleryImageUploadAction`), nunca a partir de entrada
 * do cliente — mesmo princípio de `buildProductImagePath`.
 */
export function buildProductGalleryImagePath(
  tenantId: string,
  productId: string,
  imageId: string,
  mime: ProductImageMime,
): string {
  return `${tenantId}/products/${productId}/gallery/${imageId}.${EXTENSION_BY_MIME[mime]}`;
}

/**
 * D13.1 — mesmo princípio de `isValidProductImagePath`: o cliente devolve
 * `path` ao confirmar o upload, mas o servidor nunca confia nele —
 * recomputa os 3 paths possíveis (um por mime permitido) para o
 * tenant/produto/imageId já resolvidos no servidor e exige
 * correspondência exata.
 */
export function isValidProductGalleryImagePath(
  path: string,
  tenantId: string,
  productId: string,
  imageId: string,
): boolean {
  return ALL_PRODUCT_IMAGE_MIMES.some((mime) => buildProductGalleryImagePath(tenantId, productId, imageId, mime) === path);
}

/**
 * D11.2 — decide qual URL o `ProductImageUploader` deve exibir, extraída
 * como função pura (sem DOM/React) para ser testável sem infraestrutura de
 * teste de componente (não disponível neste projeto — vitest roda em
 * `environment: "node"`, sem jsdom/@testing-library/react).
 *
 * Regra: depois de um upload confirmado com sucesso, a URL real do Storage
 * tem prioridade sobre o preview local (que pode inclusive já ter sido
 * revogado) — o preview local só é a fonte de verdade enquanto não há uma
 * confirmação do servidor (idle/error, ou o instante entre a seleção do
 * arquivo e a resposta da Server Action).
 */
export function resolveProductImagePreview(input: {
  actionStatus: "idle" | "error" | "success";
  actionImagePath: string | null | undefined;
  initialImagePath: string | null;
  previewUrl: string | null;
}): { savedPath: string | null; displayUrl: string | null; isBlobPreview: boolean } {
  const { actionStatus, actionImagePath, initialImagePath, previewUrl } = input;
  const savedPath = actionStatus === "success" ? (actionImagePath ?? null) : initialImagePath;
  const savedUrl = savedPath ? getProductImagePublicUrl(savedPath) : null;
  const displayUrl = actionStatus === "success" ? (savedUrl ?? previewUrl) : (previewUrl ?? savedUrl);
  return { savedPath, displayUrl, isBlobPreview: displayUrl !== null && displayUrl.startsWith("blob:") };
}
