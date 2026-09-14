import { isValidGalleryReorder } from "./gallery-logic";
import type { ProductOptionValueRow, ProductOptionWithValues } from "./variants-data";

/**
 * D20.8 — mutações puras sobre a lista de opções/valores AINDA NÃO
 * salvos (staged, antes do primeiro save do produto). Reaproveita a MESMA
 * representação já usada para opções/valores persistidos (D20.6,
 * `ProductOptionWithValues`/`ProductOptionValueRow`) — só que aqui `id` é
 * atribuído no cliente (`crypto.randomUUID()`, nunca pelo banco) e
 * `position` é sempre o índice no array. `ProductOptionsEditor` só
 * orquestra estas funções em cima do estado local (mesmo princípio de
 * gallery-logic.ts/variant-combinations.ts: toda decisão fica aqui, nunca
 * inline no componente) — o servidor permanece a única autoridade real: a
 * checagem de nome/valor duplicado aqui é só UX (evita um passo
 * obviamente fadado a falhar), a authoritative real acontece de novo em
 * `createProductOptionAction`/`createProductOptionValueAction` no momento
 * de persistir (Fase de persistência da Etapa 20.8).
 */

export interface StagedMutationResult {
  options: ProductOptionWithValues[];
  error?: string;
}

export function addStagedOption(options: ProductOptionWithValues[], name: string, newId: string): StagedMutationResult {
  const trimmed = name.trim();
  if (!trimmed) return { options, error: "Informe o nome da opção" };
  if (options.some((o) => o.name.toLowerCase() === trimmed.toLowerCase())) {
    return { options, error: "Já existe uma opção com esse nome neste produto." };
  }
  return { options: [...options, { id: newId, name: trimmed, position: options.length, values: [] }] };
}

export function renameStagedOption(options: ProductOptionWithValues[], optionId: string, name: string): StagedMutationResult {
  const trimmed = name.trim();
  if (!trimmed) return { options, error: "Informe o nome da opção" };
  if (options.some((o) => o.id !== optionId && o.name.toLowerCase() === trimmed.toLowerCase())) {
    return { options, error: "Já existe uma opção com esse nome neste produto." };
  }
  return { options: options.map((o) => (o.id === optionId ? { ...o, name: trimmed } : o)) };
}

export function removeStagedOption(options: ProductOptionWithValues[], optionId: string): ProductOptionWithValues[] {
  return options.filter((o) => o.id !== optionId).map((o, index) => ({ ...o, position: index }));
}

export function reorderStagedOptions(options: ProductOptionWithValues[], orderedIds: string[]): ProductOptionWithValues[] {
  if (!isValidGalleryReorder(options.map((o) => o.id), orderedIds)) return options;
  const byId = new Map(options.map((o) => [o.id, o]));
  return orderedIds.map((id, index) => ({ ...byId.get(id)!, position: index }));
}

export function addStagedValue(
  options: ProductOptionWithValues[],
  optionId: string,
  value: string,
  newId: string,
): StagedMutationResult {
  const trimmed = value.trim();
  if (!trimmed) return { options, error: "Informe o valor" };
  const option = options.find((o) => o.id === optionId);
  if (!option) return { options, error: "Opção não encontrada." };
  if (option.values.some((v) => v.value.toLowerCase() === trimmed.toLowerCase())) {
    return { options, error: "Já existe um valor igual a esse nesta opção." };
  }
  const newValue: ProductOptionValueRow = { id: newId, value: trimmed, position: option.values.length };
  return { options: options.map((o) => (o.id === optionId ? { ...o, values: [...o.values, newValue] } : o)) };
}

export function renameStagedValue(
  options: ProductOptionWithValues[],
  optionId: string,
  valueId: string,
  value: string,
): StagedMutationResult {
  const trimmed = value.trim();
  if (!trimmed) return { options, error: "Informe o valor" };
  const option = options.find((o) => o.id === optionId);
  if (!option) return { options, error: "Opção não encontrada." };
  if (option.values.some((v) => v.id !== valueId && v.value.toLowerCase() === trimmed.toLowerCase())) {
    return { options, error: "Já existe um valor igual a esse nesta opção." };
  }
  return {
    options: options.map((o) =>
      o.id === optionId ? { ...o, values: o.values.map((v) => (v.id === valueId ? { ...v, value: trimmed } : v)) } : o,
    ),
  };
}

export function removeStagedValue(options: ProductOptionWithValues[], optionId: string, valueId: string): ProductOptionWithValues[] {
  return options.map((o) =>
    o.id === optionId
      ? { ...o, values: o.values.filter((v) => v.id !== valueId).map((v, index) => ({ ...v, position: index })) }
      : o,
  );
}

export function reorderStagedValues(
  options: ProductOptionWithValues[],
  optionId: string,
  orderedValueIds: string[],
): ProductOptionWithValues[] {
  return options.map((o) => {
    if (o.id !== optionId) return o;
    if (!isValidGalleryReorder(o.values.map((v) => v.id), orderedValueIds)) return o;
    const byId = new Map(o.values.map((v) => [v.id, v]));
    return { ...o, values: orderedValueIds.map((id, index) => ({ ...byId.get(id)!, position: index })) };
  });
}

/**
 * D20.8 — cria uma opção staged já com os valores sugeridos de um preset
 * (features/products/option-presets.ts) de uma vez, sem um segundo passo
 * manual. `makeId` é injetado (nunca `crypto.randomUUID()` chamado
 * diretamente aqui) para manter esta função pura/determinística em
 * teste. Um valor sugerido que colidir com um já existente (duplicata)
 * é só ignorado — nunca interrompe os demais nem o preset inteiro.
 */
export function addPresetStagedOption(
  options: ProductOptionWithValues[],
  name: string,
  suggestedValues: readonly string[],
  makeId: () => string,
): StagedMutationResult {
  const optionId = makeId();
  const created = addStagedOption(options, name, optionId);
  if (created.error) return created;

  let next = created.options;
  for (const value of suggestedValues) {
    const added = addStagedValue(next, optionId, value, makeId());
    if (!added.error) next = added.options;
  }
  return { options: next };
}
