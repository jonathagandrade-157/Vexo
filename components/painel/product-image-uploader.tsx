"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { removeProductImageAction, uploadProductImageAction } from "@/features/products/actions";
import { getProductImagePublicUrl } from "@/features/products/image-storage";
import { initialProductImageState } from "@/features/products/schema";

function UploadStatus() {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/60">
      <span className="material-symbols-outlined animate-spin text-3xl text-on-surface">progress_activity</span>
    </div>
  );
}

/** Desabilita o input durante o envio — segunda camada de proteção contra duplo upload (prompt Etapa 8 §10/§17), além do form já serializar o próprio envio. */
function FileInputLabel({
  savedPath,
  onFileChange,
}: {
  savedPath: string | null;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const { pending } = useFormStatus();
  return (
    <label
      className={
        pending
          ? "cursor-not-allowed rounded-lg border border-outline-variant/50 px-4 py-2 font-label text-label-sm text-on-surface-variant opacity-50"
          : "cursor-pointer rounded-lg border border-outline-variant/50 px-4 py-2 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary/50 hover:text-on-surface"
      }
    >
      {savedPath ? "Substituir imagem" : "Enviar imagem"}
      <input
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        disabled={pending}
        name="file"
        onChange={onFileChange}
        type="file"
      />
    </label>
  );
}

/**
 * Só disponível na edição (produto já existe — precisa de um id real
 * para compor o path do Storage, arquitetura §9.2). Seleção de arquivo
 * dispara o envio automaticamente (sem clique extra) via
 * `requestSubmit()` num form oculto ligado a `uploadProductImageAction`
 * já vinculado ao productId (`.bind`, mesmo padrão de Server Action
 * parametrizada usado em `deleteProductAction(productId)` em
 * `ProductActions`, só que aqui via `useActionState` para ter estado de
 * pending/erro).
 */
export function ProductImageUploader({
  productId,
  initialImagePath,
}: {
  productId: string;
  initialImagePath: string | null;
}) {
  const uploadAction = uploadProductImageAction.bind(null, productId);
  const [state, formAction] = useActionState(uploadAction, initialProductImageState);
  const formRef = useRef<HTMLFormElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const savedPath = state.status === "success" ? (state.imagePath ?? null) : initialImagePath;
  const displayUrl = previewUrl ?? (savedPath ? getProductImagePublicUrl(savedPath) : null);

  // Preview local (antes/durante o upload, e mantido depois — é a mesma
  // foto que acabou de ser salva). Revogado só quando substituído por um
  // novo arquivo ou quando o componente desmonta, nunca com setState
  // dentro do próprio efeito (regra de pureza do react-compiler).
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPreviewUrl(URL.createObjectURL(file));
    formRef.current?.requestSubmit();
  }

  async function handleRemove() {
    setRemoveError(null);
    const result = await removeProductImageAction(productId);
    if (result.status === "error") {
      setRemoveError(result.message ?? "Não foi possível remover a imagem.");
    }
    return result;
  }

  return (
    <form action={formAction} className="flex flex-col gap-3" ref={formRef}>
      <div className="relative aspect-square w-full max-w-[220px] overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container-lowest">
        {displayUrl ? (
          <Image alt="" className="object-cover" fill sizes="220px" src={displayUrl} unoptimized={previewUrl !== null} />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="material-symbols-outlined text-4xl text-outline">image</span>
          </div>
        )}
        <UploadStatus />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <FileInputLabel onFileChange={handleFileChange} savedPath={savedPath} />
        {savedPath ? (
          <ConfirmDialog
            confirmLabel="Remover"
            description="Tem certeza que deseja remover a imagem deste produto?"
            onConfirm={handleRemove}
            title="Remover imagem"
            trigger={
              <span className="font-label text-label-sm text-error transition-opacity hover:opacity-80">Remover</span>
            }
          />
        ) : null}
      </div>

      <p className="font-body text-body-sm text-on-surface-variant">JPEG, PNG ou WebP — até 5MB.</p>

      {state.status === "error" ? (
        <p className="font-body text-body-sm text-error" role="alert">
          {state.message}
        </p>
      ) : null}
      {removeError ? (
        <p className="font-body text-body-sm text-error" role="alert">
          {removeError}
        </p>
      ) : null}
    </form>
  );
}
