"use client";

import Link from "next/link";
import { useTransition } from "react";

import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { deleteProductAction, toggleProductStatusAction } from "@/features/products/actions";

/** Compartilhado entre a linha de tabela (desktop) e o card (mobile) — mesmo padrão de ações em ambos, só o container visual muda. */
export function ProductActions({
  productId,
  productName,
  status,
}: {
  productId: string;
  productName: string;
  status: "active" | "inactive";
}) {
  const [isToggling, startToggle] = useTransition();
  const active = status === "active";

  return (
    <div className="flex items-center justify-end gap-1">
      <Link
        className="rounded p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-primary"
        href={`/painel/produtos/${productId}/editar`}
        title="Editar"
      >
        <span className="material-symbols-outlined text-[20px]">edit</span>
      </Link>
      <button
        className="rounded p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-primary disabled:opacity-50"
        disabled={isToggling}
        onClick={() =>
          startToggle(async () => {
            await toggleProductStatusAction(productId, active ? "inactive" : "active");
          })
        }
        title={active ? "Desativar" : "Ativar"}
        type="button"
      >
        <span className="material-symbols-outlined text-[20px]">power_settings_new</span>
      </button>
      <ConfirmDialog
        confirmLabel="Excluir"
        description={`Tem certeza que deseja excluir "${productName}"? Essa ação não pode ser desfeita.`}
        onConfirm={() => deleteProductAction(productId)}
        title="Excluir produto"
        trigger={
          <span
            className="block rounded p-1.5 text-on-surface-variant transition-colors hover:bg-error-container/20 hover:text-error"
            title="Excluir"
          >
            <span className="material-symbols-outlined text-[20px]">delete</span>
          </span>
        }
      />
    </div>
  );
}
