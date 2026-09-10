import { formatPrice } from "@/features/products/format-price";

export interface OrderSummaryLine {
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  /** D20.5 — rótulo da variante comprada (ex.: "Preto / M"), quando o item é de uma variante. */
  variantLabel?: string | null;
  /** D20.5 (correção MEDIUM-2 da revisão independente) — identidade da variante, usada só para a key da lista abaixo: duas variantes do MESMO produto podem ter nome/quantidade/preço iguais (ex.: mesma camiseta, cores diferentes, mesmo preço), o que colidiria numa key baseada só em name+quantity+unitPrice. */
  variantId?: string | null;
}

/**
 * D20.5 (correção MEDIUM-2) — key estável por linha: variantId quando o
 * item é de variante (identidade única, nunca colide entre variantes
 * diferentes do mesmo produto); fallback para name+quantity+unitPrice
 * quando não há variante — permanece seguro nesse caso porque um mesmo
 * pedido nunca tem dois order_items de produto SIMPLES para o mesmo
 * produto (cart_items força no máximo 1 linha por produto sem variante).
 */
export function orderSummaryLineKey(item: OrderSummaryLine): string {
  return item.variantId ?? `${item.name}-${item.quantity}-${item.unitPrice}`;
}

/** Reaproveitado pelo checkout (a partir do carrinho ao vivo) e pela confirmação do pedido (a partir do snapshot salvo) — mesma renderização, evita duplicar o cálculo/markup em dois lugares (prompt Etapa 10 §18). */
export function OrderSummary({
  items,
  subtotal,
  shippingTotal,
  discountTotal,
  total,
}: {
  items: OrderSummaryLine[];
  subtotal: number;
  shippingTotal: number;
  discountTotal: number;
  total: number;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
      <h2 className="font-headline text-headline-sm text-on-surface">Resumo do pedido</h2>

      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <div className="flex items-start justify-between gap-3" key={orderSummaryLineKey(item)}>
            <div className="min-w-0">
              <p className="truncate font-body text-body-sm text-on-surface">{item.name}</p>
              {item.variantLabel ? (
                <p className="truncate font-body text-body-sm text-on-surface-variant">{item.variantLabel}</p>
              ) : null}
              <p className="font-body text-body-sm text-on-surface-variant">
                {item.quantity} × {formatPrice(item.unitPrice)}
              </p>
            </div>
            <p className="whitespace-nowrap font-label text-label-sm text-on-surface">{formatPrice(item.subtotal)}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-outline-variant/20 pt-4 font-body text-body-sm text-on-surface-variant">
        <div className="flex items-center justify-between">
          <span>Subtotal</span>
          <span>{formatPrice(subtotal)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Frete</span>
          <span>{shippingTotal === 0 ? "Grátis" : formatPrice(shippingTotal)}</span>
        </div>
        {discountTotal > 0 ? (
          <div className="flex items-center justify-between">
            <span>Desconto</span>
            <span>-{formatPrice(discountTotal)}</span>
          </div>
        ) : null}
        <div className="flex items-center justify-between pt-2 font-label text-label-lg text-on-surface">
          <span>Total</span>
          <span>{formatPrice(total)}</span>
        </div>
      </div>
    </div>
  );
}
