"use client";

import Image from "next/image";
import { useState } from "react";

import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import {
  confirmProductGalleryImageUploadAction,
  deleteProductGalleryImageAction,
  prepareProductGalleryImageUploadAction,
  reorderProductGalleryAction,
  setPrimaryProductGalleryImageAction,
} from "@/features/products/actions";
import { getProductImagePublicUrl, PRODUCT_GALLERY_MAX_IMAGES } from "@/features/products/image-storage";
import type { ProductGalleryImage } from "@/features/products/schema";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/** D13.1 — mesmo prefixo de bytes de `ProductImageUploader` (D11.8) — suficiente para `sniffImageMime` reconhecer as 3 assinaturas reais. */
const MIME_SNIFF_PREFIX_BYTES = 32;

/**
 * D13.1 — substitui `ProductImageUploader` (imagem única) na seção
 * "Mídia" de `ProductForm`. Mesmo pipeline de upload direto ao Storage
 * do D11.8 (prepare → signed URL → uploadToSignedUrl → confirm), só que
 * uma imagem por vez continua sendo o fluxo de UPLOAD (nunca múltiplos
 * arquivos simultâneos numa única chamada — mantém o mesmo prefixo de
 * bytes/validação por arquivo do D11.8), mas o RESULTADO agora é uma
 * galeria (0..N imagens), não um único `main_image`.
 *
 * `ProductImageUploader` (D11.8) continua existindo no código,
 * intocado — só deixou de ser usado por `ProductForm` a partir desta
 * etapa.
 */
export function ProductGalleryUploader({
  productId,
  initialImages,
}: {
  productId: string;
  initialImages: ProductGalleryImage[];
}) {
  const [images, setImages] = useState<ProductGalleryImage[]>(initialImages);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingImageId, setPendingImageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const atLimit = images.length >= PRODUCT_GALLERY_MAX_IMAGES;

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // permite selecionar o mesmo arquivo de novo depois de um erro
    if (!file) return;

    setError(null);
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.set("size", String(file.size));
      formData.set("header", file.slice(0, MIME_SNIFF_PREFIX_BYTES));

      const prepared = await prepareProductGalleryImageUploadAction(productId, formData);
      if (prepared.status !== "success" || !prepared.upload) {
        setError(prepared.message ?? "Não foi possível preparar o upload.");
        return;
      }

      const { token, path, imageId, bucket, contentType } = prepared.upload;
      const supabase = createSupabaseBrowserClient();
      const { error: uploadError } = await supabase.storage.from(bucket).uploadToSignedUrl(path, token, file, { contentType });
      if (uploadError) {
        setError("Não foi possível enviar a imagem. Tente novamente.");
        return;
      }

      const confirmed = await confirmProductGalleryImageUploadAction(productId, imageId, path);
      if (confirmed.status !== "success" || !confirmed.images) {
        setError(confirmed.message ?? "Não foi possível salvar a imagem no produto.");
        return;
      }
      setImages(confirmed.images);
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDelete(imageId: string) {
    setError(null);
    setPendingImageId(imageId);
    try {
      const result = await deleteProductGalleryImageAction(productId, imageId);
      if (result.status === "error") {
        setError(result.message ?? "Não foi possível remover a imagem.");
        return result;
      }
      if (result.images) setImages(result.images);
      return result;
    } finally {
      setPendingImageId(null);
    }
  }

  async function handleSetPrimary(imageId: string) {
    setError(null);
    setPendingImageId(imageId);
    try {
      const result = await setPrimaryProductGalleryImageAction(productId, imageId);
      if (result.status === "error") {
        setError(result.message ?? "Não foi possível definir a imagem principal.");
        return;
      }
      if (result.images) setImages(result.images);
    } finally {
      setPendingImageId(null);
    }
  }

  /** D13.1 §13 — reorder por botões (← →), sem exigir drag-and-drop: acessível por teclado/toque, funciona igual em mobile. */
  async function handleMove(imageId: string, direction: -1 | 1) {
    const index = images.findIndex((img) => img.id === imageId);
    const targetIndex = index + direction;
    if (index === -1 || targetIndex < 0 || targetIndex >= images.length) return;

    const nextOrder = [...images];
    const [moved] = nextOrder.splice(index, 1);
    nextOrder.splice(targetIndex, 0, moved!);

    setError(null);
    setPendingImageId(imageId);
    try {
      const result = await reorderProductGalleryAction(
        productId,
        nextOrder.map((img) => img.id),
      );
      if (result.status === "error") {
        setError(result.message ?? "Não foi possível reordenar as imagens.");
        return;
      }
      if (result.images) setImages(result.images);
    } finally {
      setPendingImageId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        {images.map((image, index) => {
          const isPrimary = index === 0;
          const isPending = pendingImageId === image.id;
          return (
            <div
              className="relative flex h-24 w-24 flex-col overflow-hidden rounded-lg border border-outline-variant/30 bg-surface-container-lowest"
              key={image.id}
            >
              <Image alt="" className="object-cover" fill sizes="96px" src={getProductImagePublicUrl(image.path)} />
              {isPrimary ? (
                <span className="absolute left-1 top-1 rounded bg-primary-container px-1.5 py-0.5 font-label text-[10px] uppercase text-on-primary-container">
                  Principal
                </span>
              ) : null}
              {isPending ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <span className="material-symbols-outlined animate-spin text-xl text-on-surface">progress_activity</span>
                </div>
              ) : (
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-0.5 bg-black/70 px-1 py-1">
                  <button
                    aria-label="Mover para a esquerda"
                    className="rounded p-0.5 text-white disabled:opacity-30"
                    disabled={index === 0}
                    onClick={() => handleMove(image.id, -1)}
                    type="button"
                  >
                    <span className="material-symbols-outlined text-sm">chevron_left</span>
                  </button>
                  {!isPrimary ? (
                    <button
                      aria-label="Definir como principal"
                      className="rounded p-0.5 text-white"
                      onClick={() => handleSetPrimary(image.id)}
                      title="Definir como principal"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-sm">star</span>
                    </button>
                  ) : null}
                  <ConfirmDialog
                    confirmLabel="Excluir"
                    description="Tem certeza que deseja excluir esta imagem?"
                    onConfirm={() => handleDelete(image.id)}
                    title="Excluir imagem"
                    trigger={
                      <span aria-label="Excluir" className="block rounded p-0.5 text-white" title="Excluir">
                        <span className="material-symbols-outlined text-sm">delete</span>
                      </span>
                    }
                  />
                  <button
                    aria-label="Mover para a direita"
                    className="rounded p-0.5 text-white disabled:opacity-30"
                    disabled={index === images.length - 1}
                    onClick={() => handleMove(image.id, 1)}
                    type="button"
                  >
                    <span className="material-symbols-outlined text-sm">chevron_right</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}

        <label
          className={
            isUploading || atLimit
              ? "flex h-24 w-24 cursor-not-allowed flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-outline-variant/50 text-on-surface-variant opacity-50"
              : "flex h-24 w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-outline-variant/50 text-on-surface-variant transition-colors hover:border-primary/50 hover:text-on-surface"
          }
        >
          {isUploading ? (
            <span className="material-symbols-outlined animate-spin text-xl">progress_activity</span>
          ) : (
            <>
              <span className="material-symbols-outlined text-xl">add_photo_alternate</span>
              <span className="font-label text-[10px] uppercase">Adicionar</span>
            </>
          )}
          <input
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            disabled={isUploading || atLimit}
            onChange={handleFileChange}
            type="file"
          />
        </label>
      </div>

      <p className="font-body text-body-sm text-on-surface-variant">
        JPEG, PNG ou WebP — até 5MB cada, até {PRODUCT_GALLERY_MAX_IMAGES} imagens. A primeira é sempre a principal.
      </p>

      {error ? (
        <p className="font-body text-body-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
