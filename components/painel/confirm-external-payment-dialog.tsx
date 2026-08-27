"use client";

import { useRef, useState, useTransition } from "react";

import { confirmExternalPaymentAction } from "@/features/orders/actions";

/**
 * Fase D2-B.3 — "Confirmar pagamento" no detalhe do pedido. Mesmo padrão
 * de `<dialog>` nativo de `ConfirmDialog` (sem dependência nova), mas com
 * um campo de motivo obrigatório — por isso um componente dedicado em
 * vez de generalizar `ConfirmDialog` (que não tem esse campo e é usado
 * por exclusão de categoria/produto, sem motivo nenhum).
 *
 * `reason` é sempre exigido pela função no servidor
 * (`confirm_external_payment`, migration 20260817220085) — este campo é
 * só a coleta da UI, a validação real acontece de novo lá.
 */
export function ConfirmExternalPaymentDialog({ orderId, onConfirmed }: { orderId: string; onConfirmed?: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleOpen() {
    setReason("");
    setError(null);
    dialogRef.current?.showModal();
  }

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await confirmExternalPaymentAction(orderId, reason);
      if (result.status === "error") {
        setError(result.message ?? "Não foi possível confirmar o pagamento.");
        return;
      }
      dialogRef.current?.close();
      onConfirmed?.();
    });
  }

  return (
    <>
      <button
        className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 font-label text-label-md text-white transition-opacity hover:opacity-90"
        onClick={handleOpen}
        type="button"
      >
        Confirmar pagamento
      </button>
      <dialog
        className="w-full max-w-[440px] rounded-xl border border-surface-container-highest bg-surface-container-low p-0 text-on-surface backdrop:bg-black/60"
        ref={dialogRef}
      >
        <div className="flex flex-col gap-4 p-6">
          <h2 className="font-headline text-headline-sm text-on-surface">Confirmar pagamento</h2>
          <p className="font-body text-body-sm text-on-surface-variant">
            Confirma que o pagamento deste pedido foi recebido? Esta ação não pode ser desfeita.
          </p>

          <div className="flex flex-col gap-1.5">
            <label className="font-label text-label-md uppercase text-on-surface-variant" htmlFor="confirm-payment-reason">
              Motivo/observação
            </label>
            <textarea
              className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
              id="confirm-payment-reason"
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: comprovante do PIX recebido e conferido pelo WhatsApp."
              rows={3}
              value={reason}
            />
          </div>

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
              className="rounded-lg bg-emerald-500 px-4 py-2 font-label text-label-md text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPending || reason.trim().length === 0}
              onClick={handleConfirm}
              type="button"
            >
              {isPending ? "Confirmando…" : "Confirmar pagamento"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
