/**
 * D20.6 Fase 3.4 — lógica pura (sem I/O, sem React) de resolução da
 * variante selecionada pelo cliente no storefront. Mesmo princípio de
 * features/products/gallery-logic.ts/variant-combinations.ts:
 * `ProductVariantSelector` só orquestra estado/UI em cima destas funções,
 * nunca decide "qual variante é essa?"/"pode comprar?" inline — o que
 * torna a regra testável sem DOM (este projeto roda vitest em
 * `environment: "node"`, sem jsdom/@testing-library/react).
 */
import { canonicalizeCombination } from "@/features/products/variant-combinations";

export interface SelectableVariant {
  id: string;
  price: number;
  promotionalPrice: number | null;
  optionValueIds: readonly string[];
  inStock: boolean;
}

/**
 * Verdadeiro só quando existe ao menos uma opção E o cliente escolheu um
 * valor para CADA uma delas — nunca considera "completo" um produto sem
 * nenhuma opção (esse caso nem passa por este módulo: a página usa o
 * AddToCartButton simples direto, D20.6 Fase 3.4 §"Comportamento").
 */
export function isSelectionComplete(optionCount: number, selectedCount: number): boolean {
  return optionCount > 0 && selectedCount === optionCount;
}

export function missingOptionNames(
  options: readonly { id: string; name: string }[],
  selected: Readonly<Record<string, string>>,
): string[] {
  return options.filter((option) => !selected[option.id]).map((option) => option.name);
}

/**
 * Resolve a variante cuja combinação bate EXATAMENTE com os valores
 * selecionados (forma canônica — mesma técnica de
 * variant-combinations.ts/o CHECK do banco: ordem de clique do cliente
 * nunca importa). `variants` já deve vir filtrada para só conter variantes
 * públicas/ativas (RLS + features/storefront/product-variants.ts) — este
 * módulo nunca decide sozinho "essa variante está visível?", só compara
 * contra o que já chegou. Combinação sem variante correspondente (nunca
 * gerada, ou cuja única variante foi desativada) resolve para `null` —
 * "combinação inexistente", nunca comprável.
 */
export function resolveSelectedVariant<T extends SelectableVariant>(
  selectedValueIds: readonly string[],
  variants: readonly T[],
): T | null {
  const key = canonicalizeCombination(selectedValueIds).join("|");
  return variants.find((variant) => canonicalizeCombination(variant.optionValueIds).join("|") === key) ?? null;
}

export interface AddToCartOutcome {
  /** `true` quando o botão deve ficar bloqueado por um motivo QUE NÃO É falta de estoque (seleção incompleta, combinação inexistente). */
  disabled: boolean;
  disabledLabel?: string;
  /** Mesmo significado de PublicProduct.inStock/AddToCartButton.inStock — `false` só quando a variante resolvida existe, está ativa, mas está sem estoque. */
  inStock: boolean;
}

/**
 * Decide o que `AddToCartButton` deve mostrar — nunca a UI decidindo isso
 * inline. Ordem de prioridade: seleção incompleta > combinação inexistente
 * > sem estoque > disponível. Nunca confia em preço/disponibilidade
 * enviados pelo cliente — `resolvedVariant.inStock` já vem do servidor
 * (features/storefront/product-variants.ts), este módulo só interpreta.
 */
export function resolveAddToCartOutcome(params: {
  isComplete: boolean;
  missingOptionNames: readonly string[];
  resolvedVariant: SelectableVariant | null;
}): AddToCartOutcome {
  if (!params.isComplete) {
    return { disabled: true, disabledLabel: `Selecione: ${params.missingOptionNames.join(", ")}`, inStock: true };
  }
  if (!params.resolvedVariant) {
    return { disabled: true, disabledLabel: "Esta combinação não está disponível", inStock: true };
  }
  if (!params.resolvedVariant.inStock) {
    return { disabled: false, inStock: false };
  }
  return { disabled: false, inStock: true };
}
