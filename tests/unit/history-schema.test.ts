import { describe, expect, it } from "vitest";

import { historyFiltersSchema } from "@/features/history/schema";

/**
 * D18.4 (Fase 2) — `historyFiltersSchema` é a primeira barreira contra
 * input arbitrário de `searchParams` (sempre strings não confiáveis) antes
 * de chegar em `features/history/data.ts`. Mesmo padrão de validação de
 * toda Server Action do projeto (`features/orders/schema.ts` etc.).
 */
describe("historyFiltersSchema", () => {
  it("aceita um conjunto vazio de filtros (todos opcionais)", () => {
    const result = historyFiltersSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("trata string vazia (select/input em branco) como filtro ausente", () => {
    const result = historyFiltersSchema.safeParse({ action: "", resourceType: "", period: "", userId: "", page: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({});
    }
  });

  it("aceita uma action real do catálogo", () => {
    const result = historyFiltersSchema.safeParse({ action: "PRODUCT_CREATED" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.action).toBe("PRODUCT_CREATED");
  });

  it("descarta uma action fora do catálogo (nunca vira WHERE dinâmico)", () => {
    const result = historyFiltersSchema.safeParse({ action: "DROP TABLE audit_logs;" });
    expect(result.success).toBe(false);
  });

  it("descarta um evento de escopo Master (PLAN_CREATED não pertence ao catálogo do lojista)", () => {
    const result = historyFiltersSchema.safeParse({ action: "PLAN_CREATED" });
    expect(result.success).toBe(false);
  });

  it("exige userId como uuid válido, descarta qualquer outro formato", () => {
    expect(historyFiltersSchema.safeParse({ userId: "11111111-1111-4111-8111-111111111111" }).success).toBe(true);
    expect(historyFiltersSchema.safeParse({ userId: "not-a-uuid" }).success).toBe(false);
    expect(historyFiltersSchema.safeParse({ userId: "1 OR 1=1" }).success).toBe(false);
  });

  it("aceita resourceType/period reais do catálogo, descarta valores arbitrários", () => {
    expect(historyFiltersSchema.safeParse({ resourceType: "product" }).success).toBe(true);
    expect(historyFiltersSchema.safeParse({ resourceType: "anything" }).success).toBe(false);
    expect(historyFiltersSchema.safeParse({ period: "7d" }).success).toBe(true);
    expect(historyFiltersSchema.safeParse({ period: "forever" }).success).toBe(false);
  });

  it("page precisa ser um inteiro positivo", () => {
    expect(historyFiltersSchema.safeParse({ page: "3" }).success).toBe(true);
    expect(historyFiltersSchema.safeParse({ page: "0" }).success).toBe(false);
    expect(historyFiltersSchema.safeParse({ page: "-1" }).success).toBe(false);
    expect(historyFiltersSchema.safeParse({ page: "abc" }).success).toBe(false);
  });
});
