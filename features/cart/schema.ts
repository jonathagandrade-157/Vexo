import { z } from "zod";

/** Mínimo 1, máximo 99 — valor provisório documentado (sem conceito de estoque ainda), reforçado também pelo `check` da migration. */
export const CART_ITEM_MAX_QUANTITY = 99;

export const addToCartSchema = z.object({
  productId: z.uuid(),
  quantity: z.coerce.number().int().min(1).max(CART_ITEM_MAX_QUANTITY),
});

export const updateQuantitySchema = z.object({
  cartItemId: z.uuid(),
  quantity: z.coerce.number().int().min(0).max(CART_ITEM_MAX_QUANTITY),
});

/** Definido aqui (não em actions.ts) para não misturar export não-função num arquivo "use server" (mesmo bug da Etapa 5, evitado desde o início nas etapas seguintes). */
export interface CartActionState {
  status: "idle" | "error" | "success";
  message?: string;
}

export const initialCartActionState: CartActionState = { status: "idle" };
