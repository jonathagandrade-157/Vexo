"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { findOptionPreset, OPTION_PRESETS, type OptionPreset } from "@/features/products/option-presets";
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
import {
  createProductOptionAction,
  createProductOptionValueAction,
  deleteProductOptionAction,
  deleteProductOptionValueAction,
  reorderProductOptionsAction,
  reorderProductOptionValuesAction,
  updateProductOptionAction,
  updateProductOptionValueAction,
} from "@/features/products/variants-actions";
import type { ProductOptionActionState, ProductOptionValueActionState } from "@/features/products/variants-schema";
import type { ProductOptionValueRow, ProductOptionWithValues } from "@/features/products/variants-data";

type ActionResult = { status: string; message?: string };

/**
 * D20.8.1 — só apresentação (Melhoria 1): um ícone por preset, reaproveitando
 * o MESMO sistema de ícones já usado em todo o painel (Material Symbols via
 * `.material-symbols-outlined`, nenhuma biblioteca nova) — nunca emoji, para
 * não conflitar com o design system existente. Fica aqui (não em
 * option-presets.ts) porque é puramente visual — o arquivo de dados
 * continua sem nenhuma dependência de apresentação.
 */
const PRESET_ICONS: Record<string, string> = {
  cor: "palette",
  tamanho: "straighten",
  voltagem: "bolt",
  capacidade: "database",
  modelo: "smartphone",
  material: "texture",
};

/** D20.8 — mesmo formato das 4 Server Actions de valores (create/update/delete/reorder): em modo staged, cada uma vira uma mutação puramente local (staged-options-logic.ts) em vez de uma chamada de rede — `OptionValuesEditor` chama sempre da mesma forma, sem saber qual dos dois é. */
interface ValueActions {
  create: (optionId: string, value: string) => Promise<ProductOptionValueActionState>;
  update: (valueId: string, value: string) => Promise<ProductOptionValueActionState>;
  delete: (valueId: string) => Promise<ProductOptionValueActionState>;
  reorder: (optionId: string, orderedValueIds: string[]) => Promise<ProductOptionValueActionState>;
}

const INPUT_CLASS =
  "rounded-lg border border-outline-variant/50 bg-surface-container-lowest px-3 py-2 font-body text-body-sm text-on-surface placeholder:text-on-surface-variant focus:border-primary/50 focus:outline-none";

/**
 * D20.6 Fase 3.1 — núcleo de opções e valores (ex.: "Cor" → "Preto",
 * "Branco"). Estrutura espelha ProductGalleryUploader (mesmo padrão de
 * useState local + chamadas diretas de Server Action + reorder por botões
 * ←→, nunca drag-and-drop — D13.1 §13).
 *
 * D20.8 — `productId` passou a ser OPCIONAL: `undefined` significa
 * "produto ainda não salvo". Nesse caso, `stagedOptions`/
 * `onStagedOptionsChange` (obrigatórios juntos quando `productId` está
 * ausente) controlam a lista de fora (`ProductForm`) — nunca um useState
 * interno — porque a MESMA lista staged também alimenta a geração local
 * de combinações em `VariantsTable` e a persistência (Fase de
 * persistência da Etapa 20.8, depois que `createProductAction` devolve um
 * `productId` real). As mutações locais (criar/renomear/excluir/
 * reordenar opção e valor) vivem em `staged-options-logic.ts` (puras,
 * testadas isoladamente) — este componente só decide, por chamada, se
 * delega para elas ou para a Server Action real, nunca duplica a lógica
 * de decisão em dois lugares.
 *
 * Em modo de edição (`productId` já definido), o comportamento é
 * idêntico ao de antes da Etapa 20.8 — nenhuma mudança de comportamento,
 * só a mesma lógica de sempre agora atrás de um pequeno wrapper.
 */
export function ProductOptionsEditor({
  productId,
  initialOptions,
  onOptionsChange,
  stagedOptions,
  onStagedOptionsChange,
}: {
  productId?: string;
  initialOptions?: ProductOptionWithValues[];
  /** D20.6 Fase 3.3 — opcional: notifica um ancestral (ex.: ProductForm) sempre que a lista de opções+valores muda, para que outro componente (VariantsTable) que dependa dela (rótulos de combinação) nunca fique desatualizado sem precisar recarregar a página. */
  onOptionsChange?: (options: ProductOptionWithValues[]) => void;
  /** D20.8 — obrigatório junto com onStagedOptionsChange quando productId é undefined: a lista staged é 100% controlada por ProductForm. */
  stagedOptions?: ProductOptionWithValues[];
  onStagedOptionsChange?: (options: ProductOptionWithValues[]) => void;
}) {
  const isStaged = !productId;
  const [internalOptions, setInternalOptions] = useState<ProductOptionWithValues[]>(initialOptions ?? []);
  const options = isStaged ? (stagedOptions ?? []) : internalOptions;

  const [error, setError] = useState<string | null>(null);
  const [newOptionName, setNewOptionName] = useState("");
  const [isCreatingOption, setIsCreatingOption] = useState(false);
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null);
  const [showCustomInput, setShowCustomInput] = useState(false);

  function applyOptions(next: ProductOptionWithValues[]) {
    if (isStaged) {
      onStagedOptionsChange?.(next);
    } else {
      setInternalOptions(next);
      onOptionsChange?.(next);
    }
  }

  async function createOption(name: string): Promise<ProductOptionActionState> {
    if (!productId) {
      const result = addStagedOption(options, name, crypto.randomUUID());
      return result.error ? { status: "error", message: result.error } : { status: "success", options: result.options };
    }
    return createProductOptionAction(productId, name);
  }

  async function renameOption(optionId: string, name: string): Promise<ProductOptionActionState> {
    if (!productId) {
      const result = renameStagedOption(options, optionId, name);
      return result.error ? { status: "error", message: result.error } : { status: "success", options: result.options };
    }
    return updateProductOptionAction(optionId, name);
  }

  async function deleteOption(optionId: string): Promise<ProductOptionActionState> {
    if (!productId) {
      return { status: "success", options: removeStagedOption(options, optionId) };
    }
    return deleteProductOptionAction(optionId);
  }

  async function reorderOptions(orderedOptionIds: string[]): Promise<ProductOptionActionState> {
    if (!productId) {
      return { status: "success", options: reorderStagedOptions(options, orderedOptionIds) };
    }
    return reorderProductOptionsAction(productId, orderedOptionIds);
  }

  const valueActions: ValueActions = productId
    ? {
        create: createProductOptionValueAction,
        update: updateProductOptionValueAction,
        delete: deleteProductOptionValueAction,
        reorder: reorderProductOptionValuesAction,
      }
    : {
        create: async (optionId, value) => {
          const result = addStagedValue(options, optionId, value, crypto.randomUUID());
          if (result.error) return { status: "error", message: result.error };
          applyOptions(result.options);
          return { status: "success", values: result.options.find((o) => o.id === optionId)?.values ?? [] };
        },
        update: async (valueId, value) => {
          const owningOption = options.find((o) => o.values.some((v) => v.id === valueId));
          if (!owningOption) return { status: "error", message: "Valor não encontrado." };
          const result = renameStagedValue(options, owningOption.id, valueId, value);
          if (result.error) return { status: "error", message: result.error };
          applyOptions(result.options);
          return { status: "success", values: result.options.find((o) => o.id === owningOption.id)?.values ?? [] };
        },
        delete: async (valueId) => {
          const owningOption = options.find((o) => o.values.some((v) => v.id === valueId));
          if (!owningOption) return { status: "error", message: "Valor não encontrado." };
          const next = removeStagedValue(options, owningOption.id, valueId);
          applyOptions(next);
          return { status: "success", values: next.find((o) => o.id === owningOption.id)?.values ?? [] };
        },
        reorder: async (optionId, orderedValueIds) => {
          const next = reorderStagedValues(options, optionId, orderedValueIds);
          applyOptions(next);
          return { status: "success", values: next.find((o) => o.id === optionId)?.values ?? [] };
        },
      };

  async function handleCreateOption() {
    const name = newOptionName.trim();
    if (!name) return;

    setError(null);
    setIsCreatingOption(true);
    try {
      const result = await createOption(name);
      if (result.status === "error") {
        setError(result.message ?? "Não foi possível criar a opção.");
        return;
      }
      if (result.options) applyOptions(result.options);
      setNewOptionName("");
      setShowCustomInput(false);
    } finally {
      setIsCreatingOption(false);
    }
  }

  /** D20.8 — "Adicionar opção" por preset (features/products/option-presets.ts): cria a opção já com os valores sugeridos, num só clique — o lojista continua livre para remover/editar/adicionar valores depois, em ambos os modos. */
  async function handleAddPresetOption(preset: OptionPreset) {
    setError(null);
    setIsCreatingOption(true);
    try {
      if (!productId) {
        const result = addPresetStagedOption(options, preset.label, preset.suggestedValues, () => crypto.randomUUID());
        if (result.error) {
          setError(result.error);
          return;
        }
        applyOptions(result.options);
        return;
      }

      const created = await createProductOptionAction(productId, preset.label);
      if (created.status === "error" || !created.options) {
        setError(created.message ?? "Não foi possível criar a opção.");
        return;
      }
      applyOptions(created.options);
      const newOption = created.options.find((o) => o.name === preset.label);
      if (!newOption) return;

      let current = created.options;
      for (const value of preset.suggestedValues) {
        const valueResult = await createProductOptionValueAction(newOption.id, value);
        if (valueResult.status === "success" && valueResult.values) {
          current = current.map((o) => (o.id === newOption.id ? { ...o, values: valueResult.values! } : o));
          applyOptions(current);
        }
      }
    } finally {
      setIsCreatingOption(false);
    }
  }

  async function handleRenameOption(optionId: string, name: string): Promise<ActionResult> {
    setError(null);
    setPendingOptionId(optionId);
    try {
      const result = await renameOption(optionId, name);
      if (result.status === "error") {
        setError(result.message ?? "Não foi possível salvar a opção.");
      } else if (result.options) {
        applyOptions(result.options);
      }
      return result;
    } finally {
      setPendingOptionId(null);
    }
  }

  async function handleDeleteOption(optionId: string): Promise<ActionResult> {
    setError(null);
    setPendingOptionId(optionId);
    try {
      const result = await deleteOption(optionId);
      if (result.status === "error") {
        setError(result.message ?? "Não foi possível excluir a opção.");
      } else if (result.options) {
        applyOptions(result.options);
      }
      return result;
    } finally {
      setPendingOptionId(null);
    }
  }

  async function handleMoveOption(optionId: string, direction: -1 | 1) {
    const index = options.findIndex((o) => o.id === optionId);
    const targetIndex = index + direction;
    if (index === -1 || targetIndex < 0 || targetIndex >= options.length) return;

    const nextOrder = [...options];
    const [moved] = nextOrder.splice(index, 1);
    nextOrder.splice(targetIndex, 0, moved!);

    setError(null);
    setPendingOptionId(optionId);
    try {
      const result = await reorderOptions(nextOrder.map((o) => o.id));
      if (result.status === "error") {
        setError(result.message ?? "Não foi possível reordenar as opções.");
        return;
      }
      if (result.options) applyOptions(result.options);
    } finally {
      setPendingOptionId(null);
    }
  }

  function handleValuesChange(optionId: string, values: ProductOptionValueRow[]) {
    applyOptions(options.map((o) => (o.id === optionId ? { ...o, values } : o)));
  }

  return (
    <div className="flex flex-col gap-4">
      {options.length === 0 ? (
        <p className="font-body text-body-sm text-on-surface-variant">Nenhuma opção cadastrada.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {options.map((option, index) => (
            <OptionRow
              index={index}
              isLast={index === options.length - 1}
              isPending={pendingOptionId === option.id}
              key={option.id}
              onDelete={() => handleDeleteOption(option.id)}
              onMove={(direction) => handleMoveOption(option.id, direction)}
              onRename={(name) => handleRenameOption(option.id, name)}
              onValuesChange={(values) => handleValuesChange(option.id, values)}
              option={option}
              valueActions={valueActions}
            />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div>
          <p className="font-label text-label-md text-on-surface">Adicionar opção</p>
          <p className="font-body text-body-sm text-on-surface-variant">Escolha uma opção sugerida ou crie uma personalizada.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {OPTION_PRESETS.map((preset) => (
            <button
              className="flex items-center gap-1.5 rounded-lg border border-outline-variant/50 px-3 py-2 font-label text-label-sm text-on-surface transition-colors hover:border-primary/50 hover:bg-surface-container-lowest disabled:opacity-50"
              disabled={isCreatingOption}
              key={preset.key}
              onClick={() => handleAddPresetOption(preset)}
              type="button"
            >
              <span className="material-symbols-outlined text-[16px] text-primary">{PRESET_ICONS[preset.key] ?? "sell"}</span>
              {preset.label}
            </button>
          ))}
          <button
            className="flex items-center gap-1.5 rounded-lg border border-dashed border-outline-variant/50 px-3 py-2 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary/50 hover:text-on-surface disabled:opacity-50"
            disabled={isCreatingOption}
            onClick={() => setShowCustomInput((v) => !v)}
            type="button"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            Personalizada
          </button>
        </div>

        {showCustomInput ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`flex-1 ${INPUT_CLASS}`}
              disabled={isCreatingOption}
              onChange={(e) => setNewOptionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreateOption();
                }
              }}
              placeholder="Nome da opção personalizada (ex: Voltagem)"
              type="text"
              value={newOptionName}
            />
            <button
              className="flex items-center gap-1 rounded-lg border border-outline-variant/50 px-3 py-2 font-label text-label-sm text-on-surface transition-colors hover:border-primary/50 disabled:opacity-50"
              disabled={isCreatingOption || newOptionName.trim().length === 0}
              onClick={handleCreateOption}
              type="button"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              Adicionar opção
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="font-body text-body-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function OptionRow({
  option,
  index,
  isLast,
  isPending,
  onRename,
  onDelete,
  onMove,
  onValuesChange,
  valueActions,
}: {
  option: ProductOptionWithValues;
  index: number;
  isLast: boolean;
  isPending: boolean;
  onRename: (name: string) => Promise<ActionResult>;
  onDelete: () => Promise<ActionResult>;
  onMove: (direction: -1 | 1) => void;
  onValuesChange: (values: ProductOptionValueRow[]) => void;
  valueActions: ValueActions;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(option.name);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === option.name) {
      setName(option.name);
      setIsEditing(false);
      return;
    }
    const result = await onRename(trimmed);
    if (result.status !== "error") setIsEditing(false);
  }

  return (
    <div className="rounded-xl border border-surface-container-highest bg-[#121212] p-4">
      <div className="flex items-center gap-2">
        <div className="flex flex-col">
          <button
            aria-label="Mover opção para cima"
            className="rounded p-0.5 text-on-surface-variant disabled:opacity-30"
            disabled={index === 0 || isPending}
            onClick={() => onMove(-1)}
            type="button"
          >
            <span className="material-symbols-outlined text-base">keyboard_arrow_up</span>
          </button>
          <button
            aria-label="Mover opção para baixo"
            className="rounded p-0.5 text-on-surface-variant disabled:opacity-30"
            disabled={isLast || isPending}
            onClick={() => onMove(1)}
            type="button"
          >
            <span className="material-symbols-outlined text-base">keyboard_arrow_down</span>
          </button>
        </div>

        {isEditing ? (
          <input
            autoFocus
            className="flex-1 rounded-lg border border-primary/50 bg-surface-container-lowest px-3 py-1.5 font-label text-label-md text-on-surface focus:outline-none"
            onBlur={handleSave}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSave();
              }
              if (e.key === "Escape") {
                setName(option.name);
                setIsEditing(false);
              }
            }}
            type="text"
            value={name}
          />
        ) : (
          <button
            className="flex flex-1 items-baseline gap-2 text-left disabled:opacity-60"
            disabled={isPending}
            onClick={() => setIsEditing(true)}
            type="button"
          >
            <span className="font-label text-label-md text-on-surface">{option.name}</span>
            {/* D20.8.1 Melhoria 4 — contador discreto, sempre lido de option.values.length (a mesma prop que já rege os chips abaixo), nunca um estado próprio — atualiza sozinho a cada adição/remoção. */}
            <span className="font-body text-body-sm text-on-surface-variant">
              {option.values.length} valor{option.values.length === 1 ? "" : "es"}
            </span>
          </button>
        )}

        <ConfirmDialog
          confirmLabel="Excluir"
          description={`Tem certeza que deseja excluir a opção "${option.name}"? Todos os seus valores também serão removidos.`}
          onConfirm={onDelete}
          title="Excluir opção"
          trigger={
            <span
              aria-label="Excluir opção"
              className="block rounded p-1 text-on-surface-variant hover:text-error"
              title="Excluir opção"
            >
              <span className="material-symbols-outlined text-[18px]">delete</span>
            </span>
          }
        />
      </div>

      <div className="mt-3 pl-8">
        <OptionValuesEditor actions={valueActions} onValuesChange={onValuesChange} optionId={option.id} values={option.values} />
      </div>
    </div>
  );
}

function OptionValuesEditor({
  optionId,
  values,
  onValuesChange,
  actions,
}: {
  optionId: string;
  values: ProductOptionValueRow[];
  onValuesChange: (values: ProductOptionValueRow[]) => void;
  actions: ValueActions;
}) {
  const [error, setError] = useState<string | null>(null);
  const [newValue, setNewValue] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [pendingValueId, setPendingValueId] = useState<string | null>(null);

  async function handleCreate() {
    const value = newValue.trim();
    if (!value) return;

    setError(null);
    setIsCreating(true);
    try {
      const result = await actions.create(optionId, value);
      if (result.status === "error") {
        setError(result.message ?? "Não foi possível criar o valor.");
        return;
      }
      if (result.values) onValuesChange(result.values);
      setNewValue("");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRename(valueId: string, value: string): Promise<ActionResult> {
    setError(null);
    setPendingValueId(valueId);
    try {
      const result = await actions.update(valueId, value);
      if (result.status === "error") {
        setError(result.message ?? "Não foi possível salvar o valor.");
      } else if (result.values) {
        onValuesChange(result.values);
      }
      return result;
    } finally {
      setPendingValueId(null);
    }
  }

  async function handleDelete(valueId: string): Promise<ActionResult> {
    setError(null);
    setPendingValueId(valueId);
    try {
      const result = await actions.delete(valueId);
      if (result.status === "error") {
        setError(result.message ?? "Não foi possível excluir o valor.");
      } else if (result.values) {
        onValuesChange(result.values);
      }
      return result;
    } finally {
      setPendingValueId(null);
    }
  }

  async function handleMove(valueId: string, direction: -1 | 1) {
    const index = values.findIndex((v) => v.id === valueId);
    const targetIndex = index + direction;
    if (index === -1 || targetIndex < 0 || targetIndex >= values.length) return;

    const nextOrder = [...values];
    const [moved] = nextOrder.splice(index, 1);
    nextOrder.splice(targetIndex, 0, moved!);

    setError(null);
    setPendingValueId(valueId);
    try {
      const result = await actions.reorder(
        optionId,
        nextOrder.map((v) => v.id),
      );
      if (result.status === "error") {
        setError(result.message ?? "Não foi possível reordenar os valores.");
        return;
      }
      if (result.values) onValuesChange(result.values);
    } finally {
      setPendingValueId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {values.map((value, index) => (
            <OptionValueChip
              index={index}
              isLast={index === values.length - 1}
              isPending={pendingValueId === value.id}
              key={value.id}
              onDelete={() => handleDelete(value.id)}
              onMove={(direction) => handleMove(value.id, direction)}
              onRename={(next) => handleRename(value.id, next)}
              value={value}
            />
          ))}
        </div>
      ) : (
        <p className="font-body text-body-sm text-on-surface-variant">Nenhum valor cadastrado.</p>
      )}

      {/* D20.8.1 Melhoria 2 — "Digitar → Enter → adicionar valor" já funciona (onKeyDown abaixo, com preventDefault — nunca dispara o submit principal do formulário, mesmo antes do produto existir). Só o rótulo do botão mudou, de ícone isolado para texto + ícone ("+ Adicionar valor"), mais descobrível. */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Novo valor"
          className={`w-40 ${INPUT_CLASS} py-1.5`}
          disabled={isCreating}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleCreate();
            }
          }}
          placeholder="Novo valor"
          type="text"
          value={newValue}
        />
        <button
          className="flex items-center gap-1 rounded-lg border border-outline-variant/50 px-2.5 py-1.5 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary/50 hover:text-on-surface disabled:opacity-50"
          disabled={isCreating || newValue.trim().length === 0}
          onClick={handleCreate}
          type="button"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          Adicionar valor
        </button>
      </div>

      {error ? (
        <p className="font-body text-body-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function OptionValueChip({
  value,
  index,
  isLast,
  isPending,
  onRename,
  onDelete,
  onMove,
}: {
  value: ProductOptionValueRow;
  index: number;
  isLast: boolean;
  isPending: boolean;
  onRename: (value: string) => Promise<ActionResult>;
  onDelete: () => Promise<ActionResult>;
  onMove: (direction: -1 | 1) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(value.value);

  async function handleSave() {
    const trimmed = text.trim();
    if (!trimmed || trimmed === value.value) {
      setText(value.value);
      setIsEditing(false);
      return;
    }
    const result = await onRename(trimmed);
    if (result.status !== "error") setIsEditing(false);
  }

  return (
    <div className="flex items-center gap-1 rounded-full border border-outline-variant/50 bg-surface-container-lowest py-1 pl-1 pr-2">
      <button
        aria-label="Mover valor para a esquerda"
        className="rounded p-0.5 text-on-surface-variant disabled:opacity-30"
        disabled={index === 0 || isPending}
        onClick={() => onMove(-1)}
        type="button"
      >
        <span className="material-symbols-outlined text-sm">chevron_left</span>
      </button>

      {isEditing ? (
        <input
          autoFocus
          className="w-20 bg-transparent font-body text-body-sm text-on-surface focus:outline-none"
          onBlur={handleSave}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSave();
            }
            if (e.key === "Escape") {
              setText(value.value);
              setIsEditing(false);
            }
          }}
          type="text"
          value={text}
        />
      ) : (
        <button
          className="font-body text-body-sm text-on-surface disabled:opacity-60"
          disabled={isPending}
          onClick={() => setIsEditing(true)}
          type="button"
        >
          {value.value}
        </button>
      )}

      <button
        aria-label="Mover valor para a direita"
        className="rounded p-0.5 text-on-surface-variant disabled:opacity-30"
        disabled={isLast || isPending}
        onClick={() => onMove(1)}
        type="button"
      >
        <span className="material-symbols-outlined text-sm">chevron_right</span>
      </button>

      <ConfirmDialog
        confirmLabel="Excluir"
        description={`Tem certeza que deseja excluir o valor "${value.value}"?`}
        onConfirm={onDelete}
        title="Excluir valor"
        trigger={
          <span
            aria-label="Excluir valor"
            className="block rounded p-0.5 text-on-surface-variant hover:text-error"
            title="Excluir valor"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </span>
        }
      />
    </div>
  );
}
