import { describe, expect, it } from "vitest";

import {
  createProductOptionSchema,
  createProductOptionValueSchema,
  deleteProductOptionSchema,
  deleteProductOptionValueSchema,
  reorderProductOptionsSchema,
  reorderProductOptionValuesSchema,
  updateProductOptionSchema,
  updateProductOptionValueSchema,
} from "@/features/products/variants-schema";

const VALID_UUID_A = "11111111-1111-4111-8111-111111111111";
const VALID_UUID_B = "22222222-2222-4222-8222-222222222222";
const VALID_UUID_C = "33333333-3333-4333-8333-333333333333";

describe("createProductOptionSchema / updateProductOptionSchema (D20.6 Fase 3.1)", () => {
  it("aceita um nome válido com productId/optionId em formato UUID", () => {
    expect(createProductOptionSchema.safeParse({ productId: VALID_UUID_A, name: "Cor" }).success).toBe(true);
    expect(updateProductOptionSchema.safeParse({ optionId: VALID_UUID_A, name: "Cor" }).success).toBe(true);
  });

  it("rejeita productId/optionId que não é um UUID válido", () => {
    expect(createProductOptionSchema.safeParse({ productId: "not-a-uuid", name: "Cor" }).success).toBe(false);
    expect(updateProductOptionSchema.safeParse({ optionId: "123", name: "Cor" }).success).toBe(false);
    expect(deleteProductOptionSchema.safeParse({ optionId: "not-a-uuid" }).success).toBe(false);
  });

  it("aparra espaços do nome e rejeita nome vazio/só espaços", () => {
    const trimmed = createProductOptionSchema.safeParse({ productId: VALID_UUID_A, name: "  Tamanho  " });
    expect(trimmed.success).toBe(true);
    if (trimmed.success) expect(trimmed.data.name).toBe("Tamanho");

    expect(createProductOptionSchema.safeParse({ productId: VALID_UUID_A, name: "   " }).success).toBe(false);
    expect(createProductOptionSchema.safeParse({ productId: VALID_UUID_A, name: "" }).success).toBe(false);
  });

  it("rejeita nome acima de 60 caracteres", () => {
    const tooLong = "a".repeat(61);
    expect(createProductOptionSchema.safeParse({ productId: VALID_UUID_A, name: tooLong }).success).toBe(false);
    expect(createProductOptionSchema.safeParse({ productId: VALID_UUID_A, name: "a".repeat(60) }).success).toBe(true);
  });
});

describe("createProductOptionValueSchema / updateProductOptionValueSchema", () => {
  it("aceita um valor válido com optionId/valueId em formato UUID", () => {
    expect(createProductOptionValueSchema.safeParse({ optionId: VALID_UUID_A, value: "Preto" }).success).toBe(true);
    expect(updateProductOptionValueSchema.safeParse({ valueId: VALID_UUID_A, value: "Preto" }).success).toBe(true);
  });

  it("rejeita optionId/valueId que não é um UUID válido", () => {
    expect(createProductOptionValueSchema.safeParse({ optionId: "abc", value: "Preto" }).success).toBe(false);
    expect(updateProductOptionValueSchema.safeParse({ valueId: "abc", value: "Preto" }).success).toBe(false);
    expect(deleteProductOptionValueSchema.safeParse({ valueId: "abc" }).success).toBe(false);
  });

  it("aparra espaços e rejeita valor vazio", () => {
    const trimmed = createProductOptionValueSchema.safeParse({ optionId: VALID_UUID_A, value: "  GG  " });
    expect(trimmed.success).toBe(true);
    if (trimmed.success) expect(trimmed.data.value).toBe("GG");

    expect(createProductOptionValueSchema.safeParse({ optionId: VALID_UUID_A, value: "" }).success).toBe(false);
  });
});

describe("reorderProductOptionsSchema — mesma validação de duplicidade usada por reorderProductOptionsAction", () => {
  it("aceita uma lista de ids únicos", () => {
    const result = reorderProductOptionsSchema.safeParse({
      productId: VALID_UUID_A,
      orderedOptionIds: [VALID_UUID_B, VALID_UUID_C],
    });
    expect(result.success).toBe(true);
  });

  it("rejeita uma lista com id duplicado", () => {
    const result = reorderProductOptionsSchema.safeParse({
      productId: VALID_UUID_A,
      orderedOptionIds: [VALID_UUID_B, VALID_UUID_B],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/duplicados/i);
    }
  });

  it("rejeita lista vazia", () => {
    expect(reorderProductOptionsSchema.safeParse({ productId: VALID_UUID_A, orderedOptionIds: [] }).success).toBe(false);
  });

  it("rejeita um id inválido dentro da lista", () => {
    expect(
      reorderProductOptionsSchema.safeParse({ productId: VALID_UUID_A, orderedOptionIds: [VALID_UUID_B, "not-a-uuid"] }).success,
    ).toBe(false);
  });
});

describe("reorderProductOptionValuesSchema — mesma validação, um nível mais fundo", () => {
  it("aceita uma lista de ids únicos", () => {
    const result = reorderProductOptionValuesSchema.safeParse({
      optionId: VALID_UUID_A,
      orderedValueIds: [VALID_UUID_B, VALID_UUID_C],
    });
    expect(result.success).toBe(true);
  });

  it("rejeita uma lista com id duplicado", () => {
    const result = reorderProductOptionValuesSchema.safeParse({
      optionId: VALID_UUID_A,
      orderedValueIds: [VALID_UUID_B, VALID_UUID_B],
    });
    expect(result.success).toBe(false);
  });
});
