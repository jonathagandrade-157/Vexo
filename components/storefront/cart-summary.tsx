"use client";

import Link from "next/link";

import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { clearCartAction } from "@/features/cart/actions";
import { formatPrice } from "@/features/products/format-price";

/**
 * Botão de checkout num estado explícito "em breve" (prompt Etapa 9
 * §11/§19: sem checkout nesta etapa, mas nunca um botão morto/sem
 * função — desabilitado de propósito, com legenda explicando).
 */
export function CartSummary({
  storeSlug,
  itemCount,
  subtotal,
}: {
  storeSlug: string;
  itemCount: number;
  subtotal: number;
}) {
  return (
    <div className="sticky bottom-0 flex flex-col gap-4 border-t border-outline-variant/30 bg-surface/95 p-4 backdrop-blur-md md:static md:rounded-xl md:border md:border-outline-variant/20 md:bg-surface-container-low md:p-6">
      <div className="flex items-center justify-between font-body text-body-sm text-on-surface-variant">
        <span>{itemCount} {itemCount === 1 ? "item" : "itens"}</span>
        <span className="font-label text-label-lg text-on-surface">{formatPrice(subtotal)}</span>
      </div>

      <div className="flex flex-col gap-2">
        <button
          className="w-full cursor-not-allowed rounded-lg bg-surface-container-highest px-6 py-3 text-center font-label text-label-md text-on-surface-variant opacity-70"
          disabled
          title="O checkout será liberado numa próxima etapa."
          type="button"
        >
          Finalizar compra (em breve)
        </button>

        <div className="flex items-center justify-between gap-3">
          <Link
            className="font-label text-label-sm text-on-surface-variant transition-colors hover:text-primary"
            href={`/loja/${storeSlug}`}
          >
            Continuar comprando
          </Link>
          <ConfirmDialog
            confirmLabel="Limpar"
            description="Tem certeza que deseja remover todos os itens do carrinho?"
            onConfirm={() => clearCartAction(storeSlug)}
            title="Limpar carrinho"
            trigger={
              <span className="font-label text-label-sm text-on-surface-variant transition-colors hover:text-error">
                Limpar carrinho
              </span>
            }
          />
        </div>
      </div>
    </div>
  );
}
