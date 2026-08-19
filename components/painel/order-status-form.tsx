"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { updateOrderStatusAction } from "@/features/orders/actions";
import { ALLOWED_TRANSITIONS, ORDER_STATUS_LABELS, initialUpdateOrderStatusState, type OrderStatus } from "@/features/orders/schema";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className="rounded-lg bg-primary-container px-5 py-2.5 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? "Atualizando…" : "Avançar status"}
    </button>
  );
}

/**
 * Só oferece as transições permitidas a partir do status atual
 * (`ALLOWED_TRANSITIONS`, espelha a máquina de estados do banco) — mas
 * isto é só UX (esconder o que não faz sentido clicar). A autoridade
 * real é `update_order_status` (RPC), que valida de novo no servidor
 * independentemente do que este `<select>` oferecer.
 */
export function OrderStatusForm({ orderId, currentStatus }: { orderId: string; currentStatus: OrderStatus }) {
  const action = updateOrderStatusAction.bind(null, orderId);
  const [state, formAction] = useActionState(action, initialUpdateOrderStatusState);
  const nextOptions = ALLOWED_TRANSITIONS[currentStatus];

  if (nextOptions.length === 0) {
    return (
      <p className="font-body text-body-sm text-on-surface-variant">
        Este pedido está em um status final — nenhuma transição disponível.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="font-label text-label-md uppercase text-on-surface-variant" htmlFor="newStatus">
          Novo status
        </label>
        <select
          className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
          defaultValue=""
          id="newStatus"
          name="newStatus"
          required
        >
          <option disabled value="">
            Selecione o novo status
          </option>
          {nextOptions.map((s) => (
            <option key={s} value={s}>
              {ORDER_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="font-label text-label-md uppercase text-on-surface-variant" htmlFor="note">
          Nota interna (opcional)
        </label>
        <textarea
          className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
          id="note"
          maxLength={500}
          name="note"
          placeholder="Visível só para a equipe da loja — nunca enviada ao cliente."
          rows={2}
        />
      </div>

      {state.status === "error" && state.message ? (
        <p className="rounded-lg border border-error/30 bg-error-container/10 px-3 py-2 font-body text-body-sm text-error" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.status === "success" ? <p className="font-body text-body-sm text-emerald-400">{state.message}</p> : null}

      <SubmitButton />
    </form>
  );
}
