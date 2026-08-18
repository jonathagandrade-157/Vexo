"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { connectMercadoPagoAction, disconnectMercadoPagoAction } from "@/features/payments/actions";
import { initialPaymentConnectionState } from "@/features/payments/schema";

function ConnectButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      className="rounded-lg bg-primary-container px-5 py-2.5 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled || pending}
      type="submit"
    >
      {pending ? "Redirecionando…" : "Conectar Mercado Pago"}
    </button>
  );
}

/**
 * Nunca um campo para colar `access_token` — a conexão é sempre via
 * OAuth oficial (prompt Etapa 11 §3). Nunca mostra token/segredo, só o
 * identificador mascarado da conta conectada (arquitetura §11.1).
 */
export function PaymentConnectionCard({
  connected,
  canManage,
  maskedAccountId,
  connectedAt,
}: {
  connected: boolean;
  canManage: boolean;
  maskedAccountId: string;
  connectedAt: string | null;
}) {
  const [state, formAction] = useActionState(connectMercadoPagoAction, initialPaymentConnectionState);

  if (connected) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-outline-variant/20 bg-surface-container-low p-6">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-2xl text-primary">account_balance_wallet</span>
          <div>
            <p className="font-label text-label-md text-on-surface">Mercado Pago</p>
            <p className="flex items-center gap-1.5 font-body text-body-sm text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Conectado
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-2 font-body text-body-sm text-on-surface-variant">
          <dt>Conta conectada</dt>
          <dd className="text-right text-on-surface">{maskedAccountId}</dd>
          {connectedAt ? (
            <>
              <dt>Conectado em</dt>
              <dd className="text-right text-on-surface">{new Date(connectedAt).toLocaleDateString("pt-BR")}</dd>
            </>
          ) : null}
        </dl>
        {canManage ? (
          <ConfirmDialog
            confirmLabel="Desconectar"
            description="Tem certeza que deseja desconectar o Mercado Pago? A loja deixará de receber pagamentos até reconectar."
            onConfirm={() => disconnectMercadoPagoAction()}
            title="Desconectar Mercado Pago"
            trigger={
              <span className="w-fit rounded-lg border border-error/30 px-4 py-2 font-label text-label-sm text-error transition-colors hover:bg-error-container/10">
                Desconectar
              </span>
            }
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-outline-variant/20 bg-surface-container-low p-6">
      <div className="flex items-center gap-3">
        <span className="material-symbols-outlined text-2xl text-on-surface-variant">account_balance_wallet</span>
        <div>
          <p className="font-label text-label-md text-on-surface">Mercado Pago</p>
          <p className="font-body text-body-sm text-on-surface-variant">Não conectado</p>
        </div>
      </div>
      <p className="font-body text-body-sm text-on-surface-variant">
        Conecte sua conta do Mercado Pago para receber os pagamentos dos seus pedidos diretamente. A conexão é feita
        pela autorização oficial do Mercado Pago — a VEXO nunca solicita ou armazena sua senha.
      </p>
      <form action={formAction} className="w-fit">
        <ConnectButton disabled={!canManage} />
      </form>
      {state.status === "error" ? (
        <p className="font-body text-body-sm text-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
