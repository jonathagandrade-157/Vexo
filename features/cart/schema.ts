import { z } from "zod";

/** Mínimo 1, máximo 99 — valor provisório documentado (sem conceito de estoque ainda), reforçado também pelo `check` da migration. */
export const CART_ITEM_MAX_QUANTITY = 99;

/** D20.4 — campo ausente do form (produto simples, ainda o único caminho de UI hoje) vira `undefined`, nunca `null`/string vazia tratados como um uuid inválido. */
const emptyToUndefined = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);

export const addToCartSchema = z.object({
  productId: z.uuid(),
  quantity: z.coerce.number().int().min(1).max(CART_ITEM_MAX_QUANTITY),
  /** D20.4 — opcional: ausente/`undefined` preserva 100% o comportamento de produto simples (Etapa 9). Nunca confiado sozinho — a Action revalida que a variante existe, pertence ao tenant/produto e está ativa antes de repassar à RPC. */
  variantId: z.preprocess(emptyToUndefined, z.uuid().optional()),
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
