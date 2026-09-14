import { describe, expect, it } from "vitest";

import {
  addPresetStagedOption,
  addStagedOption,
  addStagedValue,
  removeStagedOption,
  removeStagedValue,
  renameStagedOption,
  renameStagedValue,
  reorderStagedOptions,
  reorderStagedValues,
} from "@/features/products/staged-options-logic";
import type { ProductOptionWithValues } from "@/features/products/variants-data";

/**
 * D20.8 — staging de opções/valores (antes do primeiro save do produto).
 * Cobre os itens "staging de opções", "staging de valores", "valores
 * personalizados", "remoção de opções", "remoção de valores", "ordem das
 * opções", "ordem dos valores", "produto simples sem opções", "produto
 * com uma opção", "produto com duas opções" do checklist de testes da
 * Etapa 20.8.
 */

function makeOption(id: string, name: string, values: { id: string; value: string; position: number }[] = []): ProductOptionWithValues {
  return { id, name, position: 0, values };
}

describe("addStagedOption", () => {
  it("produto simples sem opções: lista vazia + adicionar uma opção", () => {
    const result = addStagedOption([], "Cor", "opt-1");
    expect(result.error).toBeUndefined();
    expect(result.options).toEqual([{ id: "opt-1", name: "Cor", position: 0, values: [] }]);
  });

  it("nome vazio/só espaços é rejeitado", () => {
    const result = addStagedOption([], "   ", "opt-1");
    expect(result.error).toBe("Informe o nome da opção");
    expect(result.options).toEqual([]);
  });

  it("nome duplicado (case-insensitive) é rejeitado", () => {
    const existing = [makeOption("opt-1", "Cor")];
    const result = addStagedOption(existing, "cor", "opt-2");
    expect(result.error).toMatch(/já existe uma opção/i);
    expect(result.options).toBe(existing);
  });

  it("segunda opção entra na posição seguinte (produto com duas opções)", () => {
    const withCor = addStagedOption([], "Cor", "opt-1").options;
    const result = addStagedOption(withCor, "Tamanho", "opt-2");
    expect(result.options.map((o) => o.position)).toEqual([0, 1]);
  });
});

describe("renameStagedOption", () => {
  it("renomeia preservando os valores", () => {
    const options = [makeOption("opt-1", "Cor", [{ id: "v1", value: "Preto", position: 0 }])];
    const result = renameStagedOption(options, "opt-1", "Cores");
    expect(result.options[0]).toMatchObject({ name: "Cores", values: [{ id: "v1", value: "Preto", position: 0 }] });
  });

  it("colisão de nome com outra opção staged é rejeitada", () => {
    const options = [makeOption("opt-1", "Cor"), makeOption("opt-2", "Tamanho")];
    const result = renameStagedOption(options, "opt-2", "cor");
    expect(result.error).toMatch(/já existe uma opção/i);
  });
});

describe("removeStagedOption", () => {
  it("remove e recompacta as posições das demais", () => {
    const options = [makeOption("opt-1", "Cor"), makeOption("opt-2", "Tamanho"), makeOption("opt-3", "Material")];
    const result = removeStagedOption(options, "opt-2");
    expect(result.map((o) => o.id)).toEqual(["opt-1", "opt-3"]);
    expect(result.map((o) => o.position)).toEqual([0, 1]);
  });

  it("remover a única opção volta ao estado 'produto simples sem opções'", () => {
    expect(removeStagedOption([makeOption("opt-1", "Cor")], "opt-1")).toEqual([]);
  });
});

describe("reorderStagedOptions", () => {
  it("reordena por uma permutação válida", () => {
    const options = [makeOption("opt-1", "Cor"), makeOption("opt-2", "Tamanho")];
    const result = reorderStagedOptions(options, ["opt-2", "opt-1"]);
    expect(result.map((o) => o.id)).toEqual(["opt-2", "opt-1"]);
    expect(result.map((o) => o.position)).toEqual([0, 1]);
  });

  it("permutação inválida (id de fora) é ignorada, devolve a lista original", () => {
    const options = [makeOption("opt-1", "Cor"), makeOption("opt-2", "Tamanho")];
    const result = reorderStagedOptions(options, ["opt-1", "outro-id"]);
    expect(result).toBe(options);
  });
});

describe("addStagedValue / valores personalizados", () => {
  it("adiciona um valor personalizado a uma opção existente", () => {
    const options = [makeOption("opt-1", "Cor")];
    const result = addStagedValue(options, "opt-1", "Dourado", "v1");
    expect(result.error).toBeUndefined();
    expect(result.options[0]?.values).toEqual([{ id: "v1", value: "Dourado", position: 0 }]);
  });

  it("valor vazio é rejeitado", () => {
    const options = [makeOption("opt-1", "Cor")];
    const result = addStagedValue(options, "opt-1", "  ", "v1");
    expect(result.error).toBe("Informe o valor");
  });

  it("opção inexistente é rejeitada", () => {
    const result = addStagedValue([], "opt-1", "Preto", "v1");
    expect(result.error).toBe("Opção não encontrada.");
  });

  it("valor duplicado (case-insensitive) na mesma opção é rejeitado", () => {
    const options = [makeOption("opt-1", "Cor", [{ id: "v1", value: "Preto", position: 0 }])];
    const result = addStagedValue(options, "opt-1", "preto", "v2");
    expect(result.error).toMatch(/já existe um valor/i);
  });
});

describe("renameStagedValue", () => {
  it("renomeia um valor existente", () => {
    const options = [makeOption("opt-1", "Cor", [{ id: "v1", value: "Preto", position: 0 }])];
    const result = renameStagedValue(options, "opt-1", "v1", "Preto Fosco");
    expect(result.options[0]?.values[0]?.value).toBe("Preto Fosco");
  });
});

describe("removeStagedValue", () => {
  it("remove um valor e recompacta as posições", () => {
    const options = [
      makeOption("opt-1", "Cor", [
        { id: "v1", value: "Preto", position: 0 },
        { id: "v2", value: "Branco", position: 1 },
        { id: "v3", value: "Azul", position: 2 },
      ]),
    ];
    const result = removeStagedValue(options, "opt-1", "v2");
    expect(result[0]?.values.map((v) => v.id)).toEqual(["v1", "v3"]);
    expect(result[0]?.values.map((v) => v.position)).toEqual([0, 1]);
  });
});

describe("reorderStagedValues", () => {
  it("reordena os valores de uma opção", () => {
    const options = [
      makeOption("opt-1", "Cor", [
        { id: "v1", value: "Preto", position: 0 },
        { id: "v2", value: "Branco", position: 1 },
      ]),
    ];
    const result = reorderStagedValues(options, "opt-1", ["v2", "v1"]);
    expect(result[0]?.values.map((v) => v.id)).toEqual(["v2", "v1"]);
  });

  it("permutação inválida é ignorada", () => {
    const options = [makeOption("opt-1", "Cor", [{ id: "v1", value: "Preto", position: 0 }])];
    const result = reorderStagedValues(options, "opt-1", ["outro"]);
    expect(result).toEqual(options);
  });
});

describe("addPresetStagedOption — seleção de presets", () => {
  it("cria a opção já com os valores sugeridos", () => {
    let counter = 0;
    const makeId = () => `id-${counter++}`;
    const result = addPresetStagedOption([], "Cor", ["Preto", "Branco", "Azul"], makeId);
    expect(result.error).toBeUndefined();
    expect(result.options).toHaveLength(1);
    expect(result.options[0]?.name).toBe("Cor");
    expect(result.options[0]?.values.map((v) => v.value)).toEqual(["Preto", "Branco", "Azul"]);
  });

  it("preset sem valores sugeridos (ex.: Modelo) cria só a opção, vazia", () => {
    let counter = 0;
    const result = addPresetStagedOption([], "Modelo", [], () => `id-${counter++}`);
    expect(result.options[0]).toMatchObject({ name: "Modelo", values: [] });
  });

  it("nome do preset colidindo com opção já staged é rejeitado (mesma regra de addStagedOption)", () => {
    let counter = 0;
    const makeId = () => `id-${counter++}`;
    const withCor = addPresetStagedOption([], "Cor", ["Preto"], makeId).options;
    const result = addPresetStagedOption(withCor, "cor", ["Azul"], makeId);
    expect(result.error).toMatch(/já existe uma opção/i);
  });

  it("um valor sugerido duplicado é ignorado, os demais continuam sendo adicionados", () => {
    let counter = 0;
    const makeId = () => `id-${counter++}`;
    const result = addPresetStagedOption([], "Cor", ["Preto", "Preto", "Azul"], makeId);
    expect(result.options[0]?.values.map((v) => v.value)).toEqual(["Preto", "Azul"]);
  });
});
