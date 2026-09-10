import { describe, expect, it } from "vitest";

/**
 * D20.5 (correção MEDIUM-2 da revisão independente Fase 3) —
 * `orderSummaryLineKey`. O projeto não tem infraestrutura de renderização
 * de componentes React (sem @testing-library/react/jsdom), então a
 * lógica de derivação da key foi extraída como função pura e exportada
 * especificamente para ser testável aqui, sem tocar em como o componente
 * é renderizado.
 */
import { orderSummaryLineKey, type OrderSummaryLine } from "@/components/storefront/order-summary";

function line(overrides: Partial<OrderSummaryLine> = {}): OrderSummaryLine {
  return { name: "Camiseta", quantity: 1, unitPrice: 50, subtotal: 50, ...overrides };
}

describe("orderSummaryLineKey (D20.5 — correção MEDIUM-2)", () => {
  it("usa variantId como key quando o item é de variante", () => {
    const key = orderSummaryLineKey(line({ variantId: "33333333-3333-3333-3333-333333333333", variantLabel: "Preto / M" }));
    expect(key).toBe("33333333-3333-3333-3333-333333333333");
  });

  it("duas variantes do MESMO produto, mesma quantidade e mesmo preço, geram keys DIFERENTES (o bug que estava sendo corrigido)", () => {
    const keyPreto = orderSummaryLineKey(line({ variantId: "11111111-1111-1111-1111-111111111111", variantLabel: "Preto" }));
    const keyBranco = orderSummaryLineKey(line({ variantId: "22222222-2222-2222-2222-222222222222", variantLabel: "Branco" }));
    expect(keyPreto).not.toBe(keyBranco);
  });

  it("produto simples (sem variantId) cai no fallback name+quantity+unitPrice, comportamento anterior preservado", () => {
    const key = orderSummaryLineKey(line({ name: "Caneca", quantity: 2, unitPrice: 30 }));
    expect(key).toBe("Caneca-2-30");
  });

  it("variantId null (produto simples explícito) também cai no fallback, nunca vira a string 'null'", () => {
    const key = orderSummaryLineKey(line({ name: "Caneca", quantity: 2, unitPrice: 30, variantId: null }));
    expect(key).toBe("Caneca-2-30");
  });

  it("dois produtos SIMPLES diferentes continuam com keys diferentes (fallback nunca colide entre produtos distintos)", () => {
    const keyA = orderSummaryLineKey(line({ name: "Produto A", quantity: 1, unitPrice: 10 }));
    const keyB = orderSummaryLineKey(line({ name: "Produto B", quantity: 1, unitPrice: 10 }));
    expect(keyA).not.toBe(keyB);
  });
});
