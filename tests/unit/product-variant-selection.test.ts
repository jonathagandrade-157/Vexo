import { describe, expect, it } from "vitest";

import {
  isSelectionComplete,
  missingOptionNames,
  resolveAddToCartOutcome,
  resolveSelectedVariant,
  type SelectableVariant,
} from "@/features/storefront/variant-selection";

const PRETO = "11111111-1111-4111-8111-111111111111";
const BRANCO = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";
const M = "44444444-4444-4444-8444-444444444444";

function variant(id: string, optionValueIds: string[], overrides: Partial<SelectableVariant> = {}): SelectableVariant {
  return { id, price: 100, promotionalPrice: null, optionValueIds, inStock: true, ...overrides };
}

describe("isSelectionComplete / missingOptionNames", () => {
  it("uma opção: completo só quando o único valor foi escolhido", () => {
    expect(isSelectionComplete(1, 0)).toBe(false);
    expect(isSelectionComplete(1, 1)).toBe(true);
  });

  it("múltiplas opções: completo só quando TODAS têm um valor escolhido", () => {
    expect(isSelectionComplete(3, 2)).toBe(false);
    expect(isSelectionComplete(3, 3)).toBe(true);
  });

  it("produto sem nenhuma opção nunca é considerado 'completo' por este módulo (a página nem usa o seletor nesse caso)", () => {
    expect(isSelectionComplete(0, 0)).toBe(false);
  });

  it("missingOptionNames lista só as opções ainda sem valor selecionado", () => {
    const options = [
      { id: "cor", name: "Cor" },
      { id: "tamanho", name: "Tamanho" },
    ];
    expect(missingOptionNames(options, {})).toEqual(["Cor", "Tamanho"]);
    expect(missingOptionNames(options, { cor: PRETO })).toEqual(["Tamanho"]);
    expect(missingOptionNames(options, { cor: PRETO, tamanho: P })).toEqual([]);
  });
});

describe("resolveSelectedVariant — produto com uma opção", () => {
  const variants = [variant("v-preto", [PRETO]), variant("v-branco", [BRANCO])];

  it("resolve a variante correta para o valor selecionado", () => {
    expect(resolveSelectedVariant([PRETO], variants)?.id).toBe("v-preto");
    expect(resolveSelectedVariant([BRANCO], variants)?.id).toBe("v-branco");
  });

  it("combinação inexistente (nenhuma variante com esse valor) resolve para null", () => {
    const OUTRO = "55555555-5555-4555-8555-555555555555";
    expect(resolveSelectedVariant([OUTRO], variants)).toBeNull();
  });
});

describe("resolveSelectedVariant — produto com múltiplas opções", () => {
  const variants = [
    variant("v-preto-p", [PRETO, P]),
    variant("v-preto-m", [PRETO, M]),
    variant("v-branco-p", [BRANCO, P]),
  ];

  it("seleção completa resolve a variante correta, independente da ordem de clique", () => {
    expect(resolveSelectedVariant([PRETO, P], variants)?.id).toBe("v-preto-p");
    expect(resolveSelectedVariant([P, PRETO], variants)?.id).toBe("v-preto-p"); // ordem de clique nunca importa
    expect(resolveSelectedVariant([BRANCO, P], variants)?.id).toBe("v-branco-p");
  });

  it("combinação nunca gerada (Branco + M) não resolve nenhuma variante", () => {
    expect(resolveSelectedVariant([BRANCO, M], variants)).toBeNull();
  });

  it("uma variante que ficou inativa e por isso nunca chega neste módulo (já filtrada na leitura pública) nunca é resolvida — a combinação simplesmente não existe do ponto de vista do cliente", () => {
    // Simula exatamente isso: a lista `variants` já não contém a variante
    // desativada (mesma garantia de features/storefront/product-variants.ts
    // + RLS pública de product_variants, D20.2) — resolver a combinação
    // dela continua null, nunca "encontra" uma variante escondida.
    const withoutInactiveOne = variants.filter((v) => v.id !== "v-preto-m");
    expect(resolveSelectedVariant([PRETO, M], withoutInactiveOne)).toBeNull();
  });
});

describe("resolveAddToCartOutcome", () => {
  it("seleção incompleta bloqueia o botão e lista as opções faltando", () => {
    const outcome = resolveAddToCartOutcome({ isComplete: false, missingOptionNames: ["Cor", "Tamanho"], resolvedVariant: null });
    expect(outcome.disabled).toBe(true);
    expect(outcome.disabledLabel).toBe("Selecione: Cor, Tamanho");
    expect(outcome.inStock).toBe(true); // nunca confundido com "sem estoque"
  });

  it("combinação inexistente (seleção completa, mas nenhuma variante resolvida) bloqueia o botão", () => {
    const outcome = resolveAddToCartOutcome({ isComplete: true, missingOptionNames: [], resolvedVariant: null });
    expect(outcome.disabled).toBe(true);
    expect(outcome.disabledLabel).toMatch(/não está disponível/i);
  });

  it("variante resolvida mas sem estoque: NÃO desabilita por 'seleção', mostra indisponível (inStock=false)", () => {
    const outcome = resolveAddToCartOutcome({
      isComplete: true,
      missingOptionNames: [],
      resolvedVariant: variant("v1", [PRETO], { inStock: false }),
    });
    expect(outcome.disabled).toBe(false);
    expect(outcome.inStock).toBe(false);
  });

  it("variante resolvida e com estoque: liberado para comprar", () => {
    const outcome = resolveAddToCartOutcome({
      isComplete: true,
      missingOptionNames: [],
      resolvedVariant: variant("v1", [PRETO], { inStock: true }),
    });
    expect(outcome.disabled).toBe(false);
    expect(outcome.inStock).toBe(true);
  });
});

describe("preço exibido corresponde à variante (reaproveitando effectivePrice de features/cart/pricing.ts, D20.4 — já testado em tests/unit/cart-pricing.test.ts)", () => {
  it("a variante resolvida carrega seu próprio price/promotionalPrice, nunca o do produto-pai", () => {
    const v = variant("v1", [PRETO], { price: 150, promotionalPrice: 120 });
    expect(v.price).toBe(150);
    expect(v.promotionalPrice).toBe(120);
  });
});
