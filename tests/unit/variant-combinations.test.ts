import { describe, expect, it } from "vitest";

import {
  canonicalizeCombination,
  diffVariantCombinations,
  generateCombinations,
  isCanonicalCombination,
  MAX_OPTIONS_PER_PRODUCT,
  MAX_VALUES_PER_OPTION,
  MAX_VARIANTS_PER_PRODUCT,
  type OptionForCombination,
} from "@/features/products/variant-combinations";

const PRETO = "preto-1";
const BRANCO = "branco-2";
const P = "p-3";
const M = "m-4";
const G = "g-5";
const ALGODAO = "algodao-6";
const POLIESTER = "poliester-7";

describe("canonicalizeCombination / isCanonicalCombination", () => {
  it("ordena ascendente e remove duplicatas", () => {
    expect(canonicalizeCombination([G, PRETO, M])).toEqual([...[G, PRETO, M]].sort());
    expect(canonicalizeCombination([PRETO, PRETO, M])).toEqual(canonicalizeCombination([PRETO, M]));
  });

  it("isCanonicalCombination detecta arrays fora de ordem ou com duplicata", () => {
    const canonical = canonicalizeCombination([PRETO, M]);
    expect(isCanonicalCombination(canonical)).toBe(true);
    expect(isCanonicalCombination([...canonical].reverse())).toBe(canonical.length <= 1);
    expect(isCanonicalCombination([PRETO, PRETO])).toBe(false);
  });
});

describe("generateCombinations — produto cartesiano das opções", () => {
  it("uma opção: uma combinação por valor", () => {
    const options: OptionForCombination[] = [{ optionId: "cor", valueIds: [PRETO, BRANCO] }];
    const result = generateCombinations(options);
    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([canonicalizeCombination([PRETO]), canonicalizeCombination([BRANCO])]));
  });

  it("duas opções: 2 x 3 = 6 combinações, cada uma com exatamente um valor de cada opção", () => {
    const options: OptionForCombination[] = [
      { optionId: "cor", valueIds: [PRETO, BRANCO] },
      { optionId: "tamanho", valueIds: [P, M, G] },
    ];
    const result = generateCombinations(options);
    expect(result).toHaveLength(6);
    for (const combo of result) {
      expect(combo).toHaveLength(2);
      expect(combo.some((id) => id === PRETO || id === BRANCO)).toBe(true);
      expect(combo.some((id) => id === P || id === M || id === G)).toBe(true);
    }
  });

  it("três opções: cor x tamanho x material gera todas as combinações válidas (2x3x2=12)", () => {
    const options: OptionForCombination[] = [
      { optionId: "cor", valueIds: [PRETO, BRANCO] },
      { optionId: "tamanho", valueIds: [P, M, G] },
      { optionId: "material", valueIds: [ALGODAO, POLIESTER] },
    ];
    const result = generateCombinations(options);
    expect(result).toHaveLength(12);
  });

  it("combinação correta: o resultado é exatamente o produto cartesiano esperado (2x2)", () => {
    const options: OptionForCombination[] = [
      { optionId: "cor", valueIds: [PRETO, BRANCO] },
      { optionId: "tamanho", valueIds: [P, M] },
    ];
    const result = generateCombinations(options).map((c) => c.join(","));
    const expected = [
      canonicalizeCombination([PRETO, P]).join(","),
      canonicalizeCombination([PRETO, M]).join(","),
      canonicalizeCombination([BRANCO, P]).join(","),
      canonicalizeCombination([BRANCO, M]).join(","),
    ];
    expect(new Set(result)).toEqual(new Set(expected));
  });

  it("nenhuma duplicação: nenhuma combinação se repete no resultado, mesmo com muitos valores", () => {
    const options: OptionForCombination[] = [
      { optionId: "cor", valueIds: [PRETO, BRANCO] },
      { optionId: "tamanho", valueIds: [P, M, G] },
      { optionId: "material", valueIds: [ALGODAO, POLIESTER] },
    ];
    const result = generateCombinations(options).map((c) => c.join("|"));
    expect(new Set(result).size).toBe(result.length);
  });

  it("ordenação determinística: cada combinação sai na forma canônica (ascendente), e chamadas repetidas produzem o mesmo resultado", () => {
    const options: OptionForCombination[] = [
      { optionId: "cor", valueIds: [PRETO, BRANCO] },
      { optionId: "tamanho", valueIds: [P, M] },
    ];
    const first = generateCombinations(options);
    const second = generateCombinations(options);
    expect(first).toEqual(second);
    for (const combo of first) {
      expect(isCanonicalCombination(combo)).toBe(true);
    }
  });

  it("opções sem valores: uma opção com array de valores vazio faz o produto cartesiano inteiro ser vazio", () => {
    const options: OptionForCombination[] = [
      { optionId: "cor", valueIds: [PRETO, BRANCO] },
      { optionId: "tamanho", valueIds: [] },
    ];
    expect(generateCombinations(options)).toEqual([]);
  });

  it("nenhuma opção: retorna lista vazia, nunca uma combinação vazia [[]]", () => {
    expect(generateCombinations([])).toEqual([]);
  });
});

describe("diffVariantCombinations — compara o estado real do banco contra as combinações válidas", () => {
  it("geração inicial: todas as combinações são novas quando não existe nenhuma variante ainda", () => {
    const combos = generateCombinations([{ optionId: "cor", valueIds: [PRETO, BRANCO] }]);
    const diff = diffVariantCombinations(combos, []);
    expect(diff.toCreate).toHaveLength(2);
    expect(diff.keptVariantIds).toEqual([]);
    expect(diff.reviewVariantIds).toEqual([]);
  });

  it("preservação de variantes existentes: uma variante cuja combinação continua válida nunca aparece em toCreate/reviewVariantIds", () => {
    const combos = generateCombinations([{ optionId: "cor", valueIds: [PRETO, BRANCO] }]);
    const diff = diffVariantCombinations(combos, [{ id: "variant-preto", optionValueIds: canonicalizeCombination([PRETO]) }]);
    expect(diff.toCreate).toEqual([canonicalizeCombination([BRANCO])]);
    expect(diff.keptVariantIds).toEqual(["variant-preto"]);
    expect(diff.reviewVariantIds).toEqual([]);
  });

  it("geração repetida: rodar de novo com o mesmo estado não gera nada novo (idempotente)", () => {
    const combos = generateCombinations([{ optionId: "cor", valueIds: [PRETO, BRANCO] }]);
    const existing = combos.map((combo, index) => ({ id: `v${index}`, optionValueIds: combo }));
    const diff = diffVariantCombinations(combos, existing);
    expect(diff.toCreate).toEqual([]);
    expect(diff.keptVariantIds).toHaveLength(2);
  });

  it("combinação incompleta: uma variante existente com menos valores do que o número de opções atuais nunca é confundida com uma combinação válida", () => {
    const combos = generateCombinations([
      { optionId: "cor", valueIds: [PRETO] },
      { optionId: "tamanho", valueIds: [P] },
    ]);
    // variante antiga, de antes de "Tamanho" existir — só tem o valor de Cor.
    const diff = diffVariantCombinations(combos, [{ id: "old-variant", optionValueIds: [PRETO] }]);
    expect(diff.reviewVariantIds).toEqual(["old-variant"]);
    expect(diff.keptVariantIds).toEqual([]);
    expect(diff.toCreate).toEqual([canonicalizeCombination([PRETO, P])]);
  });

  it("combinação duplicada: duas variantes existentes 'apontando' para a mesma combinação (nunca deveria acontecer via constraint do banco) não duplicam toCreate nem quebram o diff", () => {
    const combos = generateCombinations([{ optionId: "cor", valueIds: [PRETO] }]);
    const diff = diffVariantCombinations(combos, [
      { id: "v1", optionValueIds: [PRETO] },
      { id: "v2", optionValueIds: [PRETO] },
    ]);
    expect(diff.toCreate).toEqual([]);
    expect(diff.keptVariantIds).toEqual(["v1", "v2"]);
  });

  it("combinação que deixou de ser válida (opção/valor removido) é sinalizada em reviewVariantIds, nunca em toCreate nem removida de keptVariantIds indevidamente", () => {
    // Produto tinha Cor=Preto/Branco; "Branco" foi excluído — só "Preto" continua válido.
    const combos = generateCombinations([{ optionId: "cor", valueIds: [PRETO] }]);
    const diff = diffVariantCombinations(combos, [
      { id: "v-preto", optionValueIds: [PRETO] },
      { id: "v-branco-orfa", optionValueIds: [BRANCO] },
    ]);
    expect(diff.keptVariantIds).toEqual(["v-preto"]);
    expect(diff.reviewVariantIds).toEqual(["v-branco-orfa"]);
    expect(diff.toCreate).toEqual([]);
  });

  it("nunca sinaliza para exclusão — reviewVariantIds é só um alerta, o diff nunca produz uma lista de 'apagar'", () => {
    const combos = generateCombinations([{ optionId: "cor", valueIds: [PRETO] }]);
    const diff = diffVariantCombinations(combos, [{ id: "v-orfa", optionValueIds: [BRANCO] }]);
    expect(diff).not.toHaveProperty("toDelete");
    expect(diff.reviewVariantIds).toEqual(["v-orfa"]);
  });
});

describe("limites (arquitetura D20 §N, já documentada em 20260817220115_product_variants.sql)", () => {
  it("os valores exportados são exatamente os já definidos pela arquitetura — não inventados nesta fase", () => {
    expect(MAX_OPTIONS_PER_PRODUCT).toBe(3);
    expect(MAX_VALUES_PER_OPTION).toBe(20);
    expect(MAX_VARIANTS_PER_PRODUCT).toBe(100);
  });

  it("10 x 10 x 10 (exemplo do prompt) excede o limite de 100 variantes/produto", () => {
    const options: OptionForCombination[] = [
      { optionId: "cor", valueIds: Array.from({ length: 10 }, (_, i) => `cor-${i}`) },
      { optionId: "tamanho", valueIds: Array.from({ length: 10 }, (_, i) => `tam-${i}`) },
      { optionId: "material", valueIds: Array.from({ length: 10 }, (_, i) => `mat-${i}`) },
    ];
    const result = generateCombinations(options);
    expect(result).toHaveLength(1000);
    expect(result.length).toBeGreaterThan(MAX_VARIANTS_PER_PRODUCT);
  });
});
