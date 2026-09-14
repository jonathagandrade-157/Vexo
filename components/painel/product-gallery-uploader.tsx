"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import {
  confirmProductGalleryImageUploadAction,
  deleteProductGalleryImageAction,
  prepareProductGalleryImageUploadAction,
  reorderProductGalleryAction,
  setPrimaryProductGalleryImageAction,
} from "@/features/products/actions";
import { acceptableFileCount, moveArrayItem, moveImageToFront, planStagedUpload } from "@/features/products/gallery-logic";
import {
  getProductImagePublicUrl,
  PRODUCT_GALLERY_MAX_IMAGES,
  validateClientSideImageFile,
  type ClientImageValidationError,
} from "@/features/products/image-storage";
import type { ProductGalleryImage } from "@/features/products/schema";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/** D13.1 — mesmo prefixo de bytes de `ProductImageUploader` (D11.8) — suficiente para `sniffImageMime` reconhecer as 3 assinaturas reais. */
const MIME_SNIFF_PREFIX_BYTES = 32;

const CLIENT_VALIDATION_MESSAGE: Record<ClientImageValidationError, string> = {
  empty: "Selecione um arquivo de imagem.",
  too_large: "Imagem muito grande. O limite é 5MB.",
  unsupported_type: "Formato não suportado. Envie um JPEG, PNG ou WebP.",
};

/** Uma imagem selecionada localmente, ainda não enviada ao Storage/banco — existe só na memória deste componente. */
interface StagedImage {
  localId: string;
  file: File;
  previewUrl: string;
  status: "pending" | "uploading" | "error";
  errorMessage?: string;
}

/**
 * D13.1 — seção "Mídia" de `ProductForm`. Pipeline de upload direto ao
 * Storage (prepare → signed URL → uploadToSignedUrl → confirm), galeria
 * (0..N imagens, primeira = principal, sem coluna própria).
 *
 * D20.7 — `productId` passou a ser OPCIONAL: `undefined` significa "produto
 * ainda não salvo" (Etapa 20.7). Nesse caso, arquivos selecionados ficam em
 * `staged` (só memória local — `File` + preview via `URL.createObjectURL`),
 * com reorder/remoção/"definir principal" 100% client-side, sem nenhuma
 * chamada ao servidor. Assim que `productId` passa a existir (o mesmo
 * componente, nunca uma segunda implementação — `ProductForm` só troca essa
 * prop depois que `createProductAction` devolve o id, sem navegar), os
 * arquivos ainda pendentes são enviados automaticamente, em sequência, na
 * ordem escolhida pelo usuário — cada `confirmProductGalleryImageUploadAction`
 * bem-sucedido entra no fim da fila real (mesma regra de sempre), o que é
 * exatamente por que enviar em ordem preserva a ordem/o "principal"
 * pretendidos sem precisar de nenhuma lógica nova no servidor.
 *
 * Em modo de edição (`productId` já definido desde o início), o
 * comportamento é o mesmo de sempre — só que agora aceita selecionar mais
 * de um arquivo de uma vez (`multiple`), cada um passando pela MESMA fila
 * `staged`→upload, sem bloquear a UI num único spinner.
 */
export function ProductGalleryUploader({
  productId,
  initialImages,
  onUploadsSettled,
}: {
  productId?: string;
  initialImages: ProductGalleryImage[];
  /** D20.7 — chamado toda vez que uma rodada de envio dos arquivos pendentes termina (automática, ao ganhar productId, ou por um clique em "Tentar novamente"). `hasPending: true` quando ao menos um arquivo ficou em erro. Quem decide o que fazer com isso (ex.: navegar para a tela de edição) é `ProductForm`, nunca este componente. */
  onUploadsSettled?: (result: { hasPending: boolean }) => void;
}) {
  const [images, setImages] = useState<ProductGalleryImage[]>(initialImages);
  const [staged, setStaged] = useState<StagedImage[]>([]);
  const [isUploadingStaged, setIsUploadingStaged] = useState(false);
  const [pendingImageId, setPendingImageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const atLimit = images.length + staged.length >= PRODUCT_GALLERY_MAX_IMAGES;

  // D20.7 — libera toda Object URL ainda em memória quando o componente
  // desmonta (ex.: usuário sai da página com arquivos selecionados e nunca
  // salvos) — nunca vaza Blob URL do navegador.
  useEffect(() => {
    return () => {
      for (const item of staged) URL.revokeObjectURL(item.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só o cleanup de desmontagem importa aqui; um efeito por mudança de `staged` revogaria previews que ainda estão em uso.
  }, []);

  async function uploadOneStagedFile(item: StagedImage): Promise<boolean> {
    if (!productId) return false;
    setStaged((prev) => prev.map((s) => (s.localId === item.localId ? { ...s, status: "uploading", errorMessage: undefined } : s)));
    try {
      const formData = new FormData();
      formData.set("size", String(item.file.size));
      formData.set("header", item.file.slice(0, MIME_SNIFF_PREFIX_BYTES));

      const prepared = await prepareProductGalleryImageUploadAction(productId, formData);
      if (prepared.status !== "success" || !prepared.upload) {
        setStaged((prev) =>
          prev.map((s) =>
            s.localId === item.localId
              ? { ...s, status: "error", errorMessage: prepared.message ?? "Não foi possível preparar o upload." }
              : s,
          ),
        );
        return false;
      }

      const { token, path, imageId, bucket, contentType } = prepared.upload;
      const supabase = createSupabaseBrowserClient();
      const { error: uploadError } = await supabase.storage.from(bucket).uploadToSignedUrl(path, token, item.file, { contentType });
      if (uploadError) {
        setStaged((prev) =>
          prev.map((s) =>
            s.localId === item.localId ? { ...s, status: "error", errorMessage: "Não foi possível enviar a imagem. Tente novamente." } : s,
          ),
        );
        return false;
      }

      const confirmed = await confirmProductGalleryImageUploadAction(productId, imageId, path);
      if (confirmed.status !== "success" || !confirmed.images) {
        setStaged((prev) =>
          prev.map((s) =>
            s.localId === item.localId
              ? { ...s, status: "error", errorMessage: confirmed.message ?? "Não foi possível salvar a imagem no produto." }
              : s,
          ),
        );
        return false;
      }

      setImages(confirmed.images);
      URL.revokeObjectURL(item.previewUrl);
      setStaged((prev) => prev.filter((s) => s.localId !== item.localId));
      return true;
    } catch {
      setStaged((prev) =>
        prev.map((s) =>
          s.localId === item.localId ? { ...s, status: "error", errorMessage: "Não foi possível enviar a imagem. Tente novamente." } : s,
        ),
      );
      return false;
    }
  }

  /**
   * D20.7 — envia exatamente os itens passados, em ordem, nunca relendo
   * `staged` no meio do caminho (evita closure desatualizada logo após um
   * `setStaged` no mesmo handler — ver `handleFilesSelected`). Se o
   * produto ainda não tem NENHUMA imagem persistida, o primeiro item desta
   * rodada é o "principal" pretendido (mesma regra de sempre: principal =
   * primeira da fila real) — se ELE falhar, a fila para imediatamente, sem
   * tentar os seguintes: nunca deixa um arquivo diferente do pretendido
   * virar principal silenciosamente. Os demais continuam disponíveis
   * (marcados "error" ou intocados) para nova tentativa — nenhum é
   * descartado.
   */
  async function runUploadQueue(items: StagedImage[]) {
    if (!productId) return;
    if (items.length === 0) {
      onUploadsSettled?.({ hasPending: staged.some((s) => s.status === "error") });
      return;
    }

    const plan = planStagedUpload(
      items.map((item) => item.localId),
      images.length > 0,
    );
    const itemByLocalId = new Map(items.map((item) => [item.localId, item]));

    setIsUploadingStaged(true);
    let hadFailure = false;
    try {
      for (const step of plan) {
        const item = itemByLocalId.get(step.id);
        if (!item) continue;
        const ok = await uploadOneStagedFile(item);
        if (!ok) {
          hadFailure = true;
          if (step.isIntendedPrimary) break;
        }
      }
    } finally {
      setIsUploadingStaged(false);
    }
    onUploadsSettled?.({ hasPending: hadFailure });
  }

  /** Reenvia os itens atualmente pendentes/com erro de `staged` — usado pelo efeito de transição de `productId` e pelo botão "Tentar novamente" (ambos disparados a partir de um render já atualizado, nunca do meio de outro handler). */
  async function uploadPendingStagedFiles() {
    await runUploadQueue(staged.filter((s) => s.status !== "uploading"));
  }

  const previousProductIdRef = useRef(productId);
  useEffect(() => {
    if (productId && !previousProductIdRef.current) {
      void uploadPendingStagedFiles();
    }
    previousProductIdRef.current = productId;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dispara só na transição undefined→definido (guardada por previousProductIdRef); `staged`/`uploadPendingStagedFiles` de propósito fora das deps, a leitura relevante é sempre a do render corrente.
  }, [productId]);

  function handleFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ""; // permite selecionar os mesmos arquivos de novo depois de um erro
    if (files.length === 0) return;

    setError(null);
    const acceptedCount = acceptableFileCount(images.length + staged.length, files.length, PRODUCT_GALLERY_MAX_IMAGES);
    if (acceptedCount <= 0) {
      setError(`Limite de ${PRODUCT_GALLERY_MAX_IMAGES} imagens por produto atingido.`);
      return;
    }

    const accepted = files.slice(0, acceptedCount);
    if (files.length > accepted.length) {
      setError(`Só foi possível adicionar ${accepted.length} de ${files.length} imagens — limite de ${PRODUCT_GALLERY_MAX_IMAGES} imagens por produto.`);
    }

    const newlyStaged: StagedImage[] = [];
    for (const file of accepted) {
      const validation = validateClientSideImageFile(file);
      if (!validation.ok) {
        setError(CLIENT_VALIDATION_MESSAGE[validation.error]);
        continue;
      }
      newlyStaged.push({ localId: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), status: "pending" });
    }
    if (newlyStaged.length === 0) return;

    setStaged((prev) => [...prev, ...newlyStaged]);
    // Produto já existe (edição, ou já foi criado nesta mesma sessão do
    // formulário): envia imediatamente, sem esperar o efeito de transição
    // acima (que só dispara uma vez, na virada undefined→definido). Passa
    // `newlyStaged` diretamente — nunca relê `staged` aqui, que neste mesmo
    // handler ainda reflete o valor de ANTES do `setStaged` acima.
    if (productId) {
      void runUploadQueue(newlyStaged);
    }
  }

  function handleRemoveStaged(localId: string) {
    setStaged((prev) => {
      const target = prev.find((s) => s.localId === localId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((s) => s.localId !== localId);
    });
  }

  function handleMoveStaged(localId: string, direction: -1 | 1) {
    setStaged((prev) => {
      const reorderedIds = moveArrayItem(
        prev.map((s) => s.localId),
        localId,
        direction,
      );
      if (!reorderedIds) return prev;
      const byId = new Map(prev.map((s) => [s.localId, s]));
      return reorderedIds.map((id) => byId.get(id)!);
    });
  }

  function handleSetPrimaryStaged(localId: string) {
    setStaged((prev) => {
      const reorderedIds = moveImageToFront(
        prev.map((s) => s.localId),
        localId,
      );
      if (!reorderedIds) return prev;
      const byId = new Map(prev.map((s) => [s.localId, s]));
      return reorderedIds.map((id) => byId.get(id)!);
    });
  }

  async function handleDeletePersisted(imageId: string) {
    if (!productId) return { status: "error", message: "Produto não encontrado." };
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

  async function handleSetPrimaryPersisted(imageId: string) {
    if (!productId) return;
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
  async function handleMovePersisted(imageId: string, direction: -1 | 1) {
    if (!productId) return;
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

  const hasFailedStaged = staged.some((s) => s.status === "error");
  // "Definir principal" só faz sentido para um item staged quando ele
  // realmente teria a chance de virar o índice 0 da galeria real — nunca
  // quando já existe alguma imagem persistida antes dele (persistidas
  // sempre precedem staged na fila real de upload).
  const canSetStagedPrimary = images.length === 0;

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
                    onClick={() => handleMovePersisted(image.id, -1)}
                    type="button"
                  >
                    <span className="material-symbols-outlined text-sm">chevron_left</span>
                  </button>
                  {!isPrimary ? (
                    <button
                      aria-label="Definir como principal"
                      className="rounded p-0.5 text-white"
                      onClick={() => handleSetPrimaryPersisted(image.id)}
                      title="Definir como principal"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-sm">star</span>
                    </button>
                  ) : null}
                  <ConfirmDialog
                    confirmLabel="Excluir"
                    description="Tem certeza que deseja excluir esta imagem?"
                    onConfirm={() => handleDeletePersisted(image.id)}
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
                    onClick={() => handleMovePersisted(image.id, 1)}
                    type="button"
                  >
                    <span className="material-symbols-outlined text-sm">chevron_right</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {staged.map((item, index) => {
          const isPrimary = images.length === 0 && index === 0;
          const isUploading = item.status === "uploading";
          const isError = item.status === "error";
          return (
            <div
              className={
                isError
                  ? "relative flex h-24 w-24 flex-col overflow-hidden rounded-lg border-2 border-error bg-surface-container-lowest"
                  : "relative flex h-24 w-24 flex-col overflow-hidden rounded-lg border border-dashed border-outline-variant/50 bg-surface-container-lowest"
              }
              key={item.localId}
            >
              <Image alt="" className="object-cover" fill sizes="96px" src={item.previewUrl} unoptimized />
              {isPrimary ? (
                <span className="absolute left-1 top-1 rounded bg-primary-container px-1.5 py-0.5 font-label text-[10px] uppercase text-on-primary-container">
                  Principal
                </span>
              ) : null}
              {isUploading ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <span className="material-symbols-outlined animate-spin text-xl text-on-surface">progress_activity</span>
                </div>
              ) : (
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-0.5 bg-black/70 px-1 py-1">
                  <button
                    aria-label="Mover para a esquerda"
                    className="rounded p-0.5 text-white disabled:opacity-30"
                    disabled={index === 0 || isUploadingStaged}
                    onClick={() => handleMoveStaged(item.localId, -1)}
                    type="button"
                  >
                    <span className="material-symbols-outlined text-sm">chevron_left</span>
                  </button>
                  {!isPrimary && canSetStagedPrimary ? (
                    <button
                      aria-label="Definir como principal"
                      className="rounded p-0.5 text-white disabled:opacity-30"
                      disabled={isUploadingStaged}
                      onClick={() => handleSetPrimaryStaged(item.localId)}
                      title="Definir como principal"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-sm">star</span>
                    </button>
                  ) : null}
                  <button
                    aria-label="Remover"
                    className="rounded p-0.5 text-white disabled:opacity-30"
                    disabled={isUploadingStaged}
                    onClick={() => handleRemoveStaged(item.localId)}
                    title="Remover"
                    type="button"
                  >
                    <span className="material-symbols-outlined text-sm">delete</span>
                  </button>
                  <button
                    aria-label="Mover para a direita"
                    className="rounded p-0.5 text-white disabled:opacity-30"
                    disabled={index === staged.length - 1 || isUploadingStaged}
                    onClick={() => handleMoveStaged(item.localId, 1)}
                    type="button"
                  >
                    <span className="material-symbols-outlined text-sm">chevron_right</span>
                  </button>
                </div>
              )}
              {isError ? (
                <span
                  className="absolute bottom-0 left-0 right-0 truncate bg-error px-1 py-0.5 text-center font-label text-[9px] uppercase text-on-error"
                  title={item.errorMessage}
                >
                  Falhou
                </span>
              ) : null}
            </div>
          );
        })}

        <label
          className={
            isUploadingStaged || atLimit
              ? "flex h-24 w-24 cursor-not-allowed flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-outline-variant/50 text-on-surface-variant opacity-50"
              : "flex h-24 w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-outline-variant/50 text-on-surface-variant transition-colors hover:border-primary/50 hover:text-on-surface"
          }
        >
          {isUploadingStaged ? (
            <span className="material-symbols-outlined animate-spin text-xl">progress_activity</span>
          ) : (
            <>
              <span className="material-symbols-outlined text-xl">add_photo_alternate</span>
              <span className="font-label text-[10px] uppercase">Adicionar</span>
            </>
          )}
          <input
            accept="image/jpeg,image/png,image/webp"
            aria-label="Adicionar imagens"
            className="hidden"
            disabled={isUploadingStaged || atLimit}
            multiple
            onChange={handleFilesSelected}
            type="file"
          />
        </label>
      </div>

      <p className="font-body text-body-sm text-on-surface-variant">
        JPEG, PNG ou WebP — até 5MB cada, até {PRODUCT_GALLERY_MAX_IMAGES} imagens. A primeira é sempre a principal.
        {!productId ? " As imagens são enviadas assim que o produto for salvo." : null}
      </p>

      {hasFailedStaged ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-error/30 bg-error-container/10 px-4 py-2">
          <p className="font-body text-body-sm text-error" role="alert">
            Algumas imagens não foram enviadas.
          </p>
          <button
            className="font-label text-label-sm text-error underline disabled:opacity-50"
            disabled={isUploadingStaged}
            onClick={() => void uploadPendingStagedFiles()}
            type="button"
          >
            Tentar novamente
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="font-body text-body-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
