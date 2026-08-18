/**
 * Extraída de `cart-cookie.ts` para não puxar `next/headers` (que exige
 * um contexto de request real) só para gerar o nome do cookie — mantém
 * esta função pura e diretamente testável.
 */
export function getCartCookieName(storeSlug: string): string {
  return `vexo_cart_${storeSlug}`;
}
