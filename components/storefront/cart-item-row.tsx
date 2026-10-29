"use client";

import Image from "next/image";
import { useTransition } from "react";

import type { CartItemView } from "@/features/cart/data";
import { removeCartItemAction, updateCartItemQuantityAction } from "@/features/cart/actions";
import { formatPrice } from "@/features/products/format-price";
import { getProductImagePublicUrl } from "@/features/products/image-storage";
import { effectivePrice } from "@/features/cart/pricing";
import { CART_ITEM_MAX_QUANTITY } from "@/features/cart/schema";

/** Mobile uses two grid rows so the image, quantity and subtotal cannot shrink the product name to zero width. Desktop keeps the same single row. */
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
    <div className="grid grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-outline-variant/20 py-4 last:border-b-0 md:flex md:gap-4">
      <div className="relative row-span-2 h-16 w-16 flex-shrink-0 self-start overflow-hidden rounded-lg border border-outline-variant/20 bg-surface-container-low md:self-auto">
        {item.product.main_image ? (
          <Image alt={item.product.name} className="object-cover" fill sizes="64px" src={getProductImagePublicUrl(item.product.main_image)} />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="material-symbols-outlined text-xl text-outline">image</span>
          </div>
        )}
      </div>

      <div className="col-start-2 row-start-1 min-w-0 flex-1">
        <p className="break-words font-label text-label-md text-on-surface md:truncate">{item.product.name}</p>
        {/* D20.6 Fase 3.5 — rótulo da variante ("Preto / M"), mesmo padrão já usado em order-summary.tsx (D20.5) para checkout/confirmação. */}
        {item.variant?.label ? <p className="break-words font-body text-body-sm text-on-surface-variant md:truncate">{item.variant.label}</p> : null}
        {item.available ? (
          <p className="font-body text-body-sm text-on-surface-variant">{formatPrice(effectivePrice(item.product, item.variant))}</p>
        ) : (
          <p className="font-body text-body-sm text-error">Produto não está mais disponível</p>
        )}
      </div>

      {item.available ? (
        <div className="col-start-2 row-start-2 flex items-center justify-self-start rounded-lg border border-outline-variant/50">
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

      <p className="col-start-3 row-start-2 w-20 text-right font-label text-label-md text-on-surface">
        {item.available ? formatPrice(effectivePrice(item.product, item.variant) * item.quantity) : "—"}
      </p>

      <button
        aria-label="Remover"
        className="col-start-3 row-start-1 justify-self-end rounded p-1.5 text-on-surface-variant transition-colors hover:bg-error-container/20 hover:text-error disabled:opacity-40"
        disabled={isPending}
        onClick={remove}
        type="button"
      >
        <span className="material-symbols-outlined text-[20px]">delete</span>
      </button>
    </div>
  );
}
