"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { addToCartAction } from "@/features/cart/actions";
import { CART_ITEM_MAX_QUANTITY, initialCartActionState } from "@/features/cart/schema";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary-container px-6 py-3 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      <span className="material-symbols-outlined text-[18px]">shopping_cart</span>
      {pending ? "Adicionando…" : "Adicionar ao carrinho"}
    </button>
  );
}

/** Formulário real (prompt Etapa 9 §9: "não criar botões meramente visuais") — quantidade + submit, confirmação inline, sem navegar (o contador do header atualiza via revalidatePath da própria action). */
export function AddToCartButton({ productId, storeSlug }: { productId: string; storeSlug: string }) {
  const action = addToCartAction.bind(null, storeSlug);
  const [state, formAction] = useActionState(action, initialCartActionState);
  const [quantity, setQuantity] = useState(1);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input name="productId" type="hidden" value={productId} />
      <div className="flex items-center gap-3">
        <div className="flex items-center rounded-lg border border-outline-variant/50">
          <button
            aria-label="Diminuir quantidade"
            className="px-3 py-2 text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-40"
            disabled={quantity <= 1}
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]">remove</span>
          </button>
          <input
            aria-label="Quantidade"
            className="w-12 border-x border-outline-variant/50 bg-transparent py-2 text-center font-label text-label-md text-on-surface focus:outline-none"
            max={CART_ITEM_MAX_QUANTITY}
            min={1}
            name="quantity"
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isInteger(next) && next >= 1 && next <= CART_ITEM_MAX_QUANTITY) setQuantity(next);
            }}
            type="number"
            value={quantity}
          />
          <button
            aria-label="Aumentar quantidade"
            className="px-3 py-2 text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-40"
            disabled={quantity >= CART_ITEM_MAX_QUANTITY}
            onClick={() => setQuantity((q) => Math.min(CART_ITEM_MAX_QUANTITY, q + 1))}
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
          </button>
        </div>
        <SubmitButton />
      </div>
      {state.status === "success" ? (
        <p className="font-body text-body-sm text-primary" role="status">
          {state.message}
        </p>
      ) : null}
      {state.status === "error" ? (
        <p className="font-body text-body-sm text-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
