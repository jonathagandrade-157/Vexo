"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { removeStoreLogoAction, uploadStoreLogoAction } from "@/features/settings/appearance-actions";
import { initialStoreLogoState } from "@/features/settings/appearance-schema";
import { getTenantMediaPublicUrl } from "@/features/settings/logo-storage";
import { extractPaletteFromImage } from "@/lib/color/extract-palette";

function UploadStatus() {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/60">
      <span className="material-symbols-outlined animate-spin text-2xl text-on-surface">progress_activity</span>
    </div>
  );
}

function FileInputLabel({
  hasLogo,
  onFileChange,
}: {
  hasLogo: boolean;
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
      {hasLogo ? "Substituir" : "Enviar logo"}
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
 * Sprint 1 — Fase A. Mesmo padrão de `components/painel/product-image-uploader.tsx`
 * (Etapa 8) — duplicado deliberadamente (não importado): esta Sprint não
 * deve tocar arquivos do domínio de catálogo/produto. Diferença real: ao
 * escolher um arquivo, também tenta extrair uma paleta local (Canvas,
 * sem IA/dependência nova — `lib/color/extract-palette.ts`) e reporta ao
 * componente pai via `onPaletteExtracted`, além de disparar o upload.
 */
export function LogoUploader({
  initialLogoPath,
  onPaletteExtracted,
  onDisplayUrlChange,
}: {
  initialLogoPath: string | null;
  onPaletteExtracted: (colors: string[]) => void;
  /** Reporta ao pai (para o painel de preview) a URL que deve ser exibida como logo — chamado no select de arquivo (preview local imediato) e na remoção (null). Nunca chamado no estado inicial: o pai já deriva isso sozinho de `initialLogoPath`. */
  onDisplayUrlChange: (url: string | null) => void;
}) {
  const [state, formAction] = useActionState(uploadStoreLogoAction, initialStoreLogoState);
  const formRef = useRef<HTMLFormElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const savedPath = state.status === "success" ? (state.logoPath ?? null) : initialLogoPath;
  const displayUrl = previewUrl ?? (savedPath ? getTenantMediaPublicUrl(savedPath) : null);

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    onDisplayUrlChange(objectUrl);

    // Extração de paleta é só uma sugestão de UX — nunca bloqueia nem
    // atrasa o upload em si, que dispara em paralelo logo abaixo.
    const img = document.createElement("img");
    img.onload = () => {
      const { colors } = extractPaletteFromImage(img);
      onPaletteExtracted(colors);
    };
    img.onerror = () => onPaletteExtracted([]);
    img.src = objectUrl;

    formRef.current?.requestSubmit();
  }

  async function handleRemove() {
    setRemoveError(null);
    const result = await removeStoreLogoAction();
    if (result.status === "error") {
      setRemoveError(result.message ?? "Não foi possível remover a logo.");
    } else {
      setPreviewUrl(null);
      onDisplayUrlChange(null);
    }
    return result;
  }

  return (
    <form action={formAction} className="flex flex-col gap-3" ref={formRef}>
      <div className="flex items-center gap-4">
        <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container-lowest">
          {displayUrl ? (
            <Image alt="" className="object-contain" fill sizes="80px" src={displayUrl} unoptimized={previewUrl !== null} />
          ) : (
            <span className="material-symbols-outlined text-3xl text-outline">storefront</span>
          )}
          <UploadStatus />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <FileInputLabel hasLogo={Boolean(savedPath)} onFileChange={handleFileChange} />
            {savedPath ? (
              <ConfirmDialog
                confirmLabel="Remover"
                description="Tem certeza que deseja remover a logo da loja?"
                onConfirm={handleRemove}
                title="Remover logo"
                trigger={<span className="font-label text-label-sm text-error transition-opacity hover:opacity-80">Remover</span>}
              />
            ) : null}
          </div>
          <p className="font-body text-body-sm text-on-surface-variant">PNG, JPEG ou WebP — até 5MB.</p>
        </div>
      </div>

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
