/**
 * D20.6 Fase 3.2 — geração de combinações de variantes (produto cartesiano
 * das opções de um produto) e o diff contra o que já existe no banco. Pura,
 * sem I/O — mesmo princípio de gallery-logic.ts: `variants-actions.ts` só
 * orquestra I/O em cima destas funções, nunca decide "quais combinações
 * existem?"/"o que já foi gerado?" inline.
 */

/**
 * arquitetura D20 §N ("LIMITES"), já documentada (não inventada aqui) no
 * comentário final de supabase/migrations/20260817220115_product_variants.sql:
 * máx. 3 opções/produto, máx. 20 valores/opção, máx. 100 variantes/produto.
 * Só o primeiro limite (cardinalidade de UMA variante <= 3) é enforced por
 * CHECK no banco (product_variants_option_value_ids_max_three) — os outros
 * dois exigiriam um trigger de COUNT(*) entre linhas, explicitamente não
 * implementado em D20.2 e fora do escopo desta fase (nenhuma migration
 * nova é autorizada aqui). Os três são enforced na Server Action
 * (generateProductVariantsAction) antes de qualquer escrita, usando
 * exatamente os valores já definidos pela arquitetura.
 */
export const MAX_OPTIONS_PER_PRODUCT = 3;
export const MAX_VALUES_PER_OPTION = 20;
export const MAX_VARIANTS_PER_PRODUCT = 100;

export interface OptionForCombination {
  optionId: string;
  valueIds: readonly string[];
}

/**
 * Ordena ascendente e remove duplicatas — a mesma forma canônica exigida
 * pelo CHECK `product_variants_option_value_ids_canonical`
 * (`private.is_canonical_option_value_ids`, migration
 * 20260817220115_product_variants.sql) no banco. Comparação lexicográfica
 * de string em JS é equivalente à comparação de bytes de uuid do Postgres
 * aqui: a representação canônica (lowercase, hifenizada) de um uuid
 * codifica seus bytes em ordem, sem reordenação — mesma conclusão já usada
 * no planejamento da Fase 2 desta épica. Nunca confiar que um array já
 * veio nessa forma vindo do cliente.
 */
export function canonicalizeCombination(valueIds: readonly string[]): string[] {
  return Array.from(new Set(valueIds)).sort();
}

export function isCanonicalCombination(valueIds: readonly string[]): boolean {
  const canonical = canonicalizeCombination(valueIds);
  return canonical.length === valueIds.length && canonical.every((id, index) => id === valueIds[index]);
}

/**
 * Produto cartesiano: exatamente um valor de CADA opção informada, uma
 * combinação por linha resultante, sempre na forma canônica. Uma opção
 * sem nenhum valor torna o produto cartesiano inteiro vazio — não existe
 * como escolher "um valor" de um conjunto vazio — nunca lança erro aqui, a
 * Action decide como comunicar isso ao lojista (opção sem valores é um
 * estado válido de exibir, não um bug desta função).
 */
export function generateCombinations(options: readonly OptionForCombination[]): string[][] {
  if (options.length === 0) return [];

  let partials: string[][] = [[]];
  for (const option of options) {
    if (option.valueIds.length === 0) return [];
    const next: string[][] = [];
    for (const partial of partials) {
      for (const valueId of option.valueIds) {
        next.push([...partial, valueId]);
      }
    }
    partials = next;
  }

  // Dedup defensivo pela forma canônica — nunca deveria disparar com
  // opções bem formadas (cada opção contribui exatamente um valor
  // distinto por combinação), mas custa nada garantir.
  const seen = new Set<string>();
  const result: string[][] = [];
  for (const combo of partials) {
    const canonical = canonicalizeCombination(combo);
    const key = canonical.join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(canonical);
  }
  return result;
}

export interface ExistingVariantForDiff {
  id: string;
  optionValueIds: readonly string[];
}

export interface VariantCombinationDiff {
  /** Combinações válidas hoje que ainda não têm uma variante correspondente — a Action cria uma para cada. */
  toCreate: string[][];
  /** Variantes existentes cuja combinação continua entre as válidas — nunca tocadas. */
  keptVariantIds: string[];
  /**
   * Variantes existentes cuja combinação NÃO está mais entre as válidas
   * (ex.: um valor usado por ela foi excluído, ou a opção deixou de
   * existir) — nunca apagadas/alteradas automaticamente aqui (prompt
   * Fase 3.2 "não apagar silenciosamente dados comerciais"), só
   * sinalizadas para o lojista revisar manualmente.
   */
  reviewVariantIds: string[];
}

/** Compara o estado real do banco (existingVariants) contra as combinações válidas hoje — nunca o inverso (nunca confia em nada vindo do cliente). */
export function diffVariantCombinations(
  validCombinations: readonly string[][],
  existingVariants: readonly ExistingVariantForDiff[],
): VariantCombinationDiff {
  const existingByKey = new Map<string, string>();
  for (const variant of existingVariants) {
    existingByKey.set(canonicalizeCombination(variant.optionValueIds).join("|"), variant.id);
  }

  const validKeys = new Set(validCombinations.map((combo) => combo.join("|")));

  const toCreate = validCombinations.filter((combo) => !existingByKey.has(combo.join("|")));

  const keptVariantIds: string[] = [];
  const reviewVariantIds: string[] = [];
  for (const variant of existingVariants) {
    const key = canonicalizeCombination(variant.optionValueIds).join("|");
    if (validKeys.has(key)) keptVariantIds.push(variant.id);
    else reviewVariantIds.push(variant.id);
  }

  return { toCreate, keptVariantIds, reviewVariantIds };
}
