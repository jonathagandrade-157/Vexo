"use client";

import { useMemo, useState } from "react";

import { AddToCartButton } from "@/components/storefront/add-to-cart-button";
import { effectivePrice } from "@/features/cart/pricing";
import { formatPrice } from "@/features/products/format-price";
import type { PublicProductOption, PublicProductVariant } from "@/features/storefront/product-variants";
import { isSelectionComplete, missingOptionNames, resolveAddToCartOutcome, resolveSelectedVariant } from "@/features/storefront/variant-selection";

/**
 * D20.6 Fase 3.4 — resolve deterministicamente a variante correspondente à
 * seleção do cliente e decide o que `AddToCartButton` deve mostrar/enviar.
 * Só renderizado pela página de produto quando o produto TEM ao menos uma
 * opção (`options.length > 0`) — produto simples continua usando
 * `AddToCartButton` diretamente, sem passar por este componente
 * (comportamento de Etapa 9/D20.4 100% preservado).
 *
 * `variants` já vem filtrado por `is_active = true` (RLS pública +
 * features/storefront/product-variants.ts) — uma variante desativada nunca
 * aparece aqui, então nunca pode ser resolvida/comprada; o mesmo vale para
 * uma combinação que nunca foi gerada no painel ("combinação inexistente").
 * A forma canônica (`canonicalizeCombination`, reaproveitada de
 * features/products/variant-combinations.ts — pura, sem I/O, o mesmo
 * módulo já usado pelo painel) é o que garante que a ordem em que o
 * cliente clica nas opções nunca importa para encontrar a variante certa.
 */
export function ProductVariantSelector({
  productId,
  storeSlug,
  product,
  options,
  variants,
}: {
  productId: string;
  storeSlug: string;
  product: { price: number; promotional_price: number | null };
  options: PublicProductOption[];
  variants: PublicProductVariant[];
}) {
  const [selected, setSelected] = useState<Record<string, string>>({});

  const sortedOptions = useMemo(() => [...options].sort((a, b) => a.position - b.position), [options]);

  const selectedValueIds = sortedOptions.map((option) => selected[option.id]).filter((id): id is string => id !== undefined);
  const isComplete = isSelectionComplete(sortedOptions.length, selectedValueIds.length);

  const resolvedVariant = useMemo(
    () => (isComplete ? resolveSelectedVariant(selectedValueIds, variants) : null),
    [isComplete, selectedValueIds, variants],
  );

  function handleSelect(optionId: string, valueId: string) {
    setSelected((prev) => ({ ...prev, [optionId]: valueId }));
  }

  // Preço: sempre via effectivePrice (features/cart/pricing.ts, D20.4) —
  // nunca uma conta própria aqui. Antes da seleção completa mostra o preço
  // do produto-base (mesmo comportamento de sempre); assim que uma
  // variante é resolvida, o preço dela prevalece (arquitetura D20 §H).
  const priceSource = resolvedVariant ? { price: resolvedVariant.price, promotional_price: resolvedVariant.promotionalPrice } : null;
  const displayPrice = priceSource ?? product;
  const effective = effectivePrice(product, priceSource);

  const { disabled, disabledLabel, inStock } = resolveAddToCartOutcome({
    isComplete,
    missingOptionNames: missingOptionNames(sortedOptions, selected),
    resolvedVariant,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {displayPrice.promotional_price !== null ? (
          <>
            <span className="font-headline text-headline-md text-on-surface">{formatPrice(effective)}</span>
            <span className="font-body text-body-lg text-on-surface-variant line-through">{formatPrice(displayPrice.price)}</span>
          </>
        ) : (
          <span className="font-headline text-headline-md text-on-surface">{formatPrice(effective)}</span>
        )}
      </div>

      {sortedOptions.map((option) => (
        <div className="flex flex-col gap-2" key={option.id}>
          <span className="font-label text-label-md uppercase text-on-surface-variant">{option.name}</span>
          <div className="flex flex-wrap gap-2" role="group">
            {[...option.values]
              .sort((a, b) => a.position - b.position)
              .map((value) => {
                const isSelected = selected[option.id] === value.id;
                return (
                  <button
                    aria-pressed={isSelected}
                    className={
                      isSelected
                        ? "rounded-lg border border-primary bg-primary-container px-4 py-2 font-label text-label-sm text-on-primary-container"
                        : "rounded-lg border border-outline-variant/50 px-4 py-2 font-label text-label-sm text-on-surface transition-colors hover:border-primary/50"
                    }
                    key={value.id}
                    onClick={() => handleSelect(option.id, value.id)}
                    type="button"
                  >
                    {value.value}
                  </button>
                );
              })}
          </div>
        </div>
      ))}

      {resolvedVariant?.sku ? <p className="font-body text-body-sm text-on-surface-variant">SKU: {resolvedVariant.sku}</p> : null}

      <AddToCartButton
        disabled={disabled}
        disabledLabel={disabledLabel}
        inStock={inStock}
        productId={productId}
        storeSlug={storeSlug}
        variantId={resolvedVariant?.id}
      />
    </div>
  );
}
