/**
 * Centralizado para não duplicar a mesma conta entre página de produto,
 * card, carrinho e (futuro) checkout — prompt Etapa 9 §8. Trabalha só
 * com os dados já confiáveis do produto (nunca um preço vindo do
 * cliente).
 */

interface PricedProduct {
  price: number;
  promotional_price: number | null;
}

export function effectivePrice(product: PricedProduct): number {
  return product.promotional_price ?? product.price;
}

export function lineSubtotal(product: PricedProduct, quantity: number): number {
  return effectivePrice(product) * quantity;
}

export function cartSubtotal(items: { product: PricedProduct; quantity: number; available: boolean }[]): number {
  return items.filter((item) => item.available).reduce((sum, item) => sum + lineSubtotal(item.product, item.quantity), 0);
}
