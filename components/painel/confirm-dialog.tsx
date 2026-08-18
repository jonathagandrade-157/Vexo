"use client";

import { useRef, useState, useTransition } from "react";

/**
 * `<dialog>` nativo (sem dependência nova) — reutilizado por exclusão de
 * categoria e de produto (prompt Etapa 7 §18: "modais/drawers... criar
 * componentes reutilizáveis somente quando necessário"). `onConfirm` é a
 * Server Action já vinculada ao id (ex.: `() => deleteProductAction(id)`).
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = "Confirmar",
  onConfirm,
  onConfirmed,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => Promise<{ status: string; message?: string }>;
  onConfirmed?: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await onConfirm();
      if (result.status === "error") {
        setError(result.message ?? "Não foi possível concluir a ação.");
        return;
      }
      dialogRef.current?.close();
      onConfirmed?.();
    });
  }

  return (
    <>
      <button onClick={() => dialogRef.current?.showModal()} type="button">
        {trigger}
      </button>
      <dialog
        className="w-full max-w-[420px] rounded-xl border border-surface-container-highest bg-surface-container-low p-0 text-on-surface backdrop:bg-black/60"
        ref={dialogRef}
      >
        <div className="flex flex-col gap-4 p-6">
          <h2 className="font-headline text-headline-sm text-on-surface">{title}</h2>
          <p className="font-body text-body-sm text-on-surface-variant">{description}</p>
          {error ? (
            <p className="rounded-lg border border-error/30 bg-error-container/10 px-3 py-2 font-body text-body-sm text-error">
              {error}
            </p>
          ) : null}
          <div className="mt-2 flex justify-end gap-3">
            <button
              className="rounded-lg px-4 py-2 font-label text-label-md text-on-surface-variant transition-colors hover:text-on-surface"
              onClick={() => dialogRef.current?.close()}
              type="button"
            >
              Cancelar
            </button>
            <button
              className="rounded-lg bg-error px-4 py-2 font-label text-label-md text-on-error transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPending}
              onClick={handleConfirm}
              type="button"
            >
              {isPending ? "Aguarde…" : confirmLabel}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
