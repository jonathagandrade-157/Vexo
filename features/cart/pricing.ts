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

/**
 * D20.4 — mesmo formato de preço de PricedProduct: quando um item de
 * carrinho tem variante (product_variants.price/promotional_price), o
 * preço da variante é o efetivamente cobrado, NUNCA o do produto-pai
 * (arquitetura D20 §H — mesma regra que create_order_from_cart vai
 * aplicar no checkout, D20.5).
 */
interface PricedVariant {
  price: number;
  promotional_price: number | null;
}

export function effectivePrice(product: PricedProduct, variant?: PricedVariant | null): number {
  const source = variant ?? product;
  return source.promotional_price ?? source.price;
}

export function lineSubtotal(product: PricedProduct, quantity: number, variant?: PricedVariant | null): number {
  return effectivePrice(product, variant) * quantity;
}

export function cartSubtotal(
  items: { product: PricedProduct; variant?: PricedVariant | null; quantity: number; available: boolean }[],
): number {
  return items
    .filter((item) => item.available)
    .reduce((sum, item) => sum + lineSubtotal(item.product, item.quantity, item.variant), 0);
}
