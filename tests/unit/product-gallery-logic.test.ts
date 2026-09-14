import { describe, expect, it } from "vitest";

import {
  acceptableFileCount,
  computeGallerySortOrder,
  isValidGalleryReorder,
  moveArrayItem,
  moveImageToFront,
  planStagedUpload,
} from "@/features/products/gallery-logic";

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

/**
 * D20.7 — reorder por botões ←→ de arquivos ainda não enviados (seleção
 * antes do primeiro save do produto, `ProductGalleryUploader`). Cobre o
 * item "Ordenação das imagens" do checklist de testes da Etapa 20.7.
 */
describe("moveArrayItem — reorder por botões ←→ (D20.7)", () => {
  it("move um item uma posição para a direita", () => {
    expect(moveArrayItem(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
  });

  it("move um item uma posição para a esquerda", () => {
    expect(moveArrayItem(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
  });

  it("já está no limite esquerdo → null (nada a mover)", () => {
    expect(moveArrayItem(["a", "b", "c"], "a", -1)).toBeNull();
  });

  it("já está no limite direito → null (nada a mover)", () => {
    expect(moveArrayItem(["a", "b", "c"], "c", 1)).toBeNull();
  });

  it("id inexistente → null", () => {
    expect(moveArrayItem(["a", "b", "c"], "z", 1)).toBeNull();
  });

  it("preserva a ordem relativa dos itens não envolvidos no movimento", () => {
    expect(moveArrayItem(["a", "b", "c", "d"], "b", 1)).toEqual(["a", "c", "b", "d"]);
  });
});

/**
 * D20.7 — quantos arquivos de uma seleção múltipla cabem no limite da
 * galeria. Cobre "quantidade acima do limite é rejeitada".
 */
describe("acceptableFileCount (D20.7)", () => {
  it("aceita todos quando há espaço de sobra", () => {
    expect(acceptableFileCount(0, 3, 8)).toBe(3);
  });

  it("aceita só o que cabe até o limite quando a seleção excede o espaço restante", () => {
    expect(acceptableFileCount(6, 5, 8)).toBe(2);
  });

  it("já no limite → 0, mesmo com arquivos novos selecionados", () => {
    expect(acceptableFileCount(8, 1, 8)).toBe(0);
  });

  it("acima do limite (defensivo) → 0, nunca negativo", () => {
    expect(acceptableFileCount(9, 1, 8)).toBe(0);
  });

  it("nenhum arquivo selecionado → 0", () => {
    expect(acceptableFileCount(0, 0, 8)).toBe(0);
  });
});

/**
 * D20.7 — plano de envio de uma rodada de upload: ordem + qual item é o
 * "principal" pretendido. Cobre "Definição da imagem principal" e
 * "Upload parcial" (a decisão de parar a fila quando o principal falha
 * vive em ProductGalleryUploader, mas depende inteiramente deste plano).
 */
describe("planStagedUpload (D20.7)", () => {
  it("sem nenhuma imagem persistida: o primeiro item da rodada é o principal pretendido", () => {
    expect(planStagedUpload(["a", "b", "c"], false)).toEqual([
      { id: "a", isIntendedPrimary: true },
      { id: "b", isIntendedPrimary: false },
      { id: "c", isIntendedPrimary: false },
    ]);
  });

  it("já existe imagem persistida: nenhum item da rodada é 'principal pretendido' (o principal já está definido)", () => {
    expect(planStagedUpload(["a", "b"], true)).toEqual([
      { id: "a", isIntendedPrimary: false },
      { id: "b", isIntendedPrimary: false },
    ]);
  });

  it("lista vazia → []", () => {
    expect(planStagedUpload([], false)).toEqual([]);
  });

  it("preserva a ordem recebida — nunca reordena por conta própria", () => {
    const plan = planStagedUpload(["z", "y", "x"], false);
    expect(plan.map((s) => s.id)).toEqual(["z", "y", "x"]);
  });
});
