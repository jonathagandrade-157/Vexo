/**
 * D20.8 — sugestões de UX para "Adicionar opção" (Etapa 20.8): substituem
 * o campo de texto vazio por atalhos de nome + valores comuns já
 * pré-preenchidos. SÓ sugestão — o lojista pode remover/editar/adicionar
 * valores livremente depois, e "Personalizada" continua disponível para
 * qualquer nome fora desta lista. Dados estáticos, sem I/O, por isso
 * testável isoladamente sem o componente.
 */
export interface OptionPreset {
  key: string;
  label: string;
  /** Valores sugeridos ao escolher este preset — só os 3 primeiros (Cor, Tamanho, Voltagem) têm uma lista conhecida no ticket da Etapa 20.8; os demais ficam vazios (o lojista adiciona os valores manualmente) em vez de inventar dados não especificados. */
  suggestedValues: readonly string[];
}

export const OPTION_PRESETS: readonly OptionPreset[] = [
  { key: "cor", label: "Cor", suggestedValues: ["Preto", "Branco", "Azul", "Vermelho", "Verde", "Rosa", "Cinza"] },
  { key: "tamanho", label: "Tamanho", suggestedValues: ["PP", "P", "M", "G", "GG", "XGG"] },
  { key: "voltagem", label: "Voltagem", suggestedValues: ["110V", "220V", "Bivolt"] },
  { key: "capacidade", label: "Capacidade", suggestedValues: [] },
  { key: "modelo", label: "Modelo", suggestedValues: [] },
  { key: "material", label: "Material", suggestedValues: [] },
];

/** Sentinela de "Personalizada" — nunca um preset de verdade, sempre disponível junto da lista acima (nunca limita o lojista aos presets). */
export const CUSTOM_OPTION_PRESET_KEY = "personalizada";

export function findOptionPreset(key: string): OptionPreset | undefined {
  return OPTION_PRESETS.find((preset) => preset.key === key);
}
