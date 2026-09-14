import { describe, expect, it } from "vitest";

import { CUSTOM_OPTION_PRESET_KEY, findOptionPreset, OPTION_PRESETS } from "@/features/products/option-presets";

describe("OPTION_PRESETS", () => {
  it("inclui os presets citados no ticket da Etapa 20.8", () => {
    const labels = OPTION_PRESETS.map((p) => p.label);
    expect(labels).toEqual(["Cor", "Tamanho", "Voltagem", "Capacidade", "Modelo", "Material"]);
  });

  it("Cor sugere os valores exatos do ticket", () => {
    const cor = findOptionPreset("cor");
    expect(cor?.suggestedValues).toEqual(["Preto", "Branco", "Azul", "Vermelho", "Verde", "Rosa", "Cinza"]);
  });

  it("Tamanho sugere os valores exatos do ticket", () => {
    expect(findOptionPreset("tamanho")?.suggestedValues).toEqual(["PP", "P", "M", "G", "GG", "XGG"]);
  });

  it("Voltagem sugere os valores exatos do ticket", () => {
    expect(findOptionPreset("voltagem")?.suggestedValues).toEqual(["110V", "220V", "Bivolt"]);
  });

  it("chave inexistente devolve undefined (nunca lança)", () => {
    expect(findOptionPreset("inexistente")).toBeUndefined();
  });

  it("CUSTOM_OPTION_PRESET_KEY nunca colide com a key de um preset real — 'Personalizada' sempre disponível à parte", () => {
    expect(OPTION_PRESETS.some((p) => p.key === CUSTOM_OPTION_PRESET_KEY)).toBe(false);
  });
});
