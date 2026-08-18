"use client";

import Link from "next/link";

import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { clearCartAction } from "@/features/cart/actions";
import { formatPrice } from "@/features/products/format-price";

/** Botão de checkout real a partir da Etapa 10 (era desabilitado "em breve" na Etapa 9). */
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
        <Link
          className="w-full rounded-lg bg-primary-container px-6 py-3 text-center font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6]"
          href={`/loja/${storeSlug}/checkout`}
        >
          Finalizar compra
        </Link>

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
