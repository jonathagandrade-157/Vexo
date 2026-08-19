"use client";

import Image from "next/image";
import { useTransition } from "react";

import type { CartItemView } from "@/features/cart/data";
import { removeCartItemAction, updateCartItemQuantityAction } from "@/features/cart/actions";
import { formatPrice } from "@/features/products/format-price";
import { getProductImagePublicUrl } from "@/features/products/image-storage";
import { effectivePrice } from "@/features/cart/pricing";
import { CART_ITEM_MAX_QUANTITY } from "@/features/cart/schema";

/** Uma linha por produto — mesma estrutura em desktop e mobile (prompt Etapa 9 §12: "não criar uma segunda versão visual independente"), só o espaçamento se adapta via classes responsivas. */
export function CartItemRow({ item, storeSlug }: { item: CartItemView; storeSlug: string }) {
  const [isPending, startTransition] = useTransition();

  function changeQuantity(next: number) {
    startTransition(async () => {
      await updateCartItemQuantityAction(storeSlug, item.id, next);
    });
  }

  function remove() {
    startTransition(async () => {
      await removeCartItemAction(storeSlug, item.id);
    });
  }

  return (
    <div className="flex items-center gap-4 border-b border-outline-variant/20 py-4 last:border-b-0">
      <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-outline-variant/20 bg-surface-container-low">
        {item.product.main_image ? (
          <Image alt={item.product.name} className="object-cover" fill sizes="64px" src={getProductImagePublicUrl(item.product.main_image)} />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="material-symbols-outlined text-xl text-outline">image</span>
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-label text-label-md text-on-surface">{item.product.name}</p>
        {item.available ? (
          <p className="font-body text-body-sm text-on-surface-variant">{formatPrice(effectivePrice(item.product))}</p>
        ) : (
          <p className="font-body text-body-sm text-error">Produto não está mais disponível</p>
        )}
      </div>

      {item.available ? (
        <div className="flex items-center rounded-lg border border-outline-variant/50">
          <button
            aria-label="Diminuir quantidade"
            className="px-2 py-1.5 text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-40"
            disabled={isPending}
            onClick={() => changeQuantity(item.quantity - 1)}
            type="button"
          >
            <span className="material-symbols-outlined text-[16px]">remove</span>
          </button>
          <span className="w-8 text-center font-label text-label-sm text-on-surface">{item.quantity}</span>
          <button
            aria-label="Aumentar quantidade"
            className="px-2 py-1.5 text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-40"
            disabled={isPending || item.quantity >= CART_ITEM_MAX_QUANTITY}
            onClick={() => changeQuantity(item.quantity + 1)}
            type="button"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
          </button>
        </div>
      ) : null}

      <p className="w-20 text-right font-label text-label-md text-on-surface">
        {item.available ? formatPrice(effectivePrice(item.product) * item.quantity) : "—"}
      </p>

      <button
        aria-label="Remover"
        className="rounded p-1.5 text-on-surface-variant transition-colors hover:bg-error-container/20 hover:text-error disabled:opacity-40"
        disabled={isPending}
        onClick={remove}
        type="button"
      >
        <span className="material-symbols-outlined text-[20px]">delete</span>
      </button>
    </div>
  );
}
