import { describe, expect, it } from "vitest";

import { computeGallerySortOrder, isValidGalleryReorder, moveImageToFront } from "@/features/products/gallery-logic";

/**
 * D13.1 — lógica pura de reordenação da galeria (sem banco, sem React) —
 * mesmo princípio de testabilidade já usado em `image-storage.ts`
 * (D11.2/D11.8) e `features/onboarding/progress-logic.ts` (D12.2).
 */

describe("isValidGalleryReorder", () => {
  it("aceita uma permutação exata do conjunto atual", () => {
    expect(isValidGalleryReorder(["a", "b", "c"], ["c", "a", "b"])).toBe(true);
  });

  it("aceita a mesma ordem (no-op)", () => {
    expect(isValidGalleryReorder(["a", "b", "c"], ["a", "b", "c"])).toBe(true);
  });

  it("rejeita tamanho diferente (imagem faltando)", () => {
    expect(isValidGalleryReorder(["a", "b", "c"], ["a", "b"])).toBe(false);
  });

  it("rejeita id de outro produto/tenant 'inserido' no meio", () => {
    expect(isValidGalleryReorder(["a", "b", "c"], ["a", "b", "x"])).toBe(false);
  });

  it("rejeita duplicata no pedido", () => {
    expect(isValidGalleryReorder(["a", "b", "c"], ["a", "a", "b"])).toBe(false);
  });

  it("lista vazia é uma permutação válida de lista vazia", () => {
    expect(isValidGalleryReorder([], [])).toBe(true);
  });

  it("rejeita reordenar quando não há imagem nenhuma mas o pedido tem uma", () => {
    expect(isValidGalleryReorder([], ["a"])).toBe(false);
  });
});

describe("computeGallerySortOrder", () => {
  it("a posição no array define o sort_order, começando em 0", () => {
    expect(computeGallerySortOrder(["c", "a", "b"])).toEqual([
      { id: "c", sortOrder: 0 },
      { id: "a", sortOrder: 1 },
      { id: "b", sortOrder: 2 },
    ]);
  });

  it("array vazio → []", () => {
    expect(computeGallerySortOrder([])).toEqual([]);
  });

  it("uma única imagem → sort_order 0", () => {
    expect(computeGallerySortOrder(["only"])).toEqual([{ id: "only", sortOrder: 0 }]);
  });
});

describe("moveImageToFront — 'definir como principal'", () => {
  it("move o id alvo para o início, preservando a ordem relativa das demais", () => {
    expect(moveImageToFront(["a", "b", "c", "d"], "c")).toEqual(["c", "a", "b", "d"]);
  });

  it("já está no início → resultado idêntico (idempotente)", () => {
    expect(moveImageToFront(["a", "b", "c"], "a")).toEqual(["a", "b", "c"]);
  });

  it("é o último → vai para o início, mantendo a ordem dos outros", () => {
    expect(moveImageToFront(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
  });

  it("id não pertence à galeria atual → null (nunca 'inventa' uma posição)", () => {
    expect(moveImageToFront(["a", "b", "c"], "z")).toBeNull();
  });

  it("galeria de uma única imagem → resultado idêntico", () => {
    expect(moveImageToFront(["only"], "only")).toEqual(["only"]);
  });

  it("galeria vazia → null", () => {
    expect(moveImageToFront([], "a")).toBeNull();
  });
});
