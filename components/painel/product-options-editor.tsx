"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/components/painel/confirm-dialog";
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
import type { ProductOptionValueRow, ProductOptionWithValues } from "@/features/products/variants-data";

type ActionResult = { status: string; message?: string };

const INPUT_CLASS =
  "rounded-lg border border-outline-variant/50 bg-surface-container-lowest px-3 py-2 font-body text-body-sm text-on-surface placeholder:text-on-surface-variant focus:border-primary/50 focus:outline-none";

/**
 * D20.6 Fase 3.1 — núcleo de opções e valores (ex.: "Cor" → "Preto",
 * "Branco"). Estrutura espelha ProductGalleryUploader (mesmo padrão de
 * useState local + chamadas diretas de Server Action + reorder por botões
 * ←→, nunca drag-and-drop — D13.1 §13): sem geração de combinações, sem
 * tabela product_variants, sem estoque por variante (fora do escopo desta
 * fase).
 */
export function ProductOptionsEditor({
  productId,
  initialOptions,
  onOptionsChange,
}: {
  productId: string;
  initialOptions: ProductOptionWithValues[];
  /** D20.6 Fase 3.3 — opcional: notifica um ancestral (ex.: ProductForm) sempre que a lista de opções+valores muda, para que outro componente (VariantsTable) que dependa dela (rótulos de combinação) nunca fique desatualizado sem precisar recarregar a página. Nunca obrigatório — este componente continua 100% funcional sozinho sem ele (mesmo comportamento da Fase 3.1). */
  onOptionsChange?: (options: ProductOptionWithValues[]) => void;
}) {
  const [options, setOptions] = useState<ProductOptionWithValues[]>(initialOptions);
  const [error, setError] = useState<string | null>(null);
  const [newOptionName, setNewOptionName] = useState("");
  const [isCreatingOption, setIsCreatingOption] = useState(false);
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null);

  function applyOptions(next: ProductOptionWithValues[]) {
    setOptions(next);
    onOptionsChange?.(next);
  }

  async function handleCreateOption() {
    const name = newOptionName.trim();
    if (!name) return;

    setError(null);
    setIsCreatingOption(true);
    try {
      const result = await createProductOptionAction(productId, name);
      if (result.status === "error") {
        setError(result.message ?? "Não foi possível criar a opção.");
        return;
      }
      if (result.options) applyOptions(result.options);
      setNewOptionName("");
    } finally {
      setIsCreatingOption(false);
    }
  }

  async function handleRenameOption(optionId: string, name: string): Promise<ActionResult> {
    setError(null);
    setPendingOptionId(optionId);
    try {
      const result = await updateProductOptionAction(optionId, name);
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
      const result = await deleteProductOptionAction(optionId);
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
      const result = await reorderProductOptionsAction(
        productId,
        nextOrder.map((o) => o.id),
      );
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
            />
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
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
          placeholder="Nova opção (ex: Tamanho, Cor)"
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
}: {
  option: ProductOptionWithValues;
  index: number;
  isLast: boolean;
  isPending: boolean;
  onRename: (name: string) => Promise<ActionResult>;
  onDelete: () => Promise<ActionResult>;
  onMove: (direction: -1 | 1) => void;
  onValuesChange: (values: ProductOptionValueRow[]) => void;
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
            className="flex-1 text-left font-label text-label-md text-on-surface disabled:opacity-60"
            disabled={isPending}
            onClick={() => setIsEditing(true)}
            type="button"
          >
            {option.name}
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
        <OptionValuesEditor onValuesChange={onValuesChange} optionId={option.id} values={option.values} />
      </div>
    </div>
  );
}

function OptionValuesEditor({
  optionId,
  values,
  onValuesChange,
}: {
  optionId: string;
  values: ProductOptionValueRow[];
  onValuesChange: (values: ProductOptionValueRow[]) => void;
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
      const result = await createProductOptionValueAction(optionId, value);
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
      const result = await updateProductOptionValueAction(valueId, value);
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
      const result = await deleteProductOptionValueAction(valueId);
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
      const result = await reorderProductOptionValuesAction(
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

      <div className="flex items-center gap-2">
        <input
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
          aria-label="Adicionar valor"
          className="rounded-lg border border-outline-variant/50 p-1.5 text-on-surface-variant transition-colors hover:border-primary/50 hover:text-on-surface disabled:opacity-50"
          disabled={isCreating || newValue.trim().length === 0}
          onClick={handleCreate}
          type="button"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
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
