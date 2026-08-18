"use client";

import { useTransition } from "react";

import { CategoryFormDialog } from "@/components/painel/category-form-dialog";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { deleteCategoryAction, toggleCategoryStatusAction } from "@/features/categories/actions";

export interface CategoryRowData {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "inactive";
  productCount: number;
}

export function CategoryRow({ category, canManage }: { category: CategoryRowData; canManage: boolean }) {
  const [isToggling, startToggle] = useTransition();
  const active = category.status === "active";

  return (
    <div className="grid grid-cols-12 items-center gap-4 px-6 py-4 transition-colors hover:bg-[#1E1E1E]">
      <div className="col-span-5 flex items-center gap-3 md:col-span-6">
        <div className="flex h-8 w-8 items-center justify-center rounded border border-outline-variant bg-surface-container-highest">
          <span className="material-symbols-outlined text-[18px] text-primary">sell</span>
        </div>
        <span className="font-body text-body-md font-medium text-on-surface">{category.name}</span>
      </div>
      <div className="col-span-2 text-center font-label text-label-md text-on-surface-variant">
        {category.productCount}
      </div>
      <div className="col-span-3 flex justify-center md:col-span-2">
        <span
          className={
            active
              ? "rounded-full bg-emerald-500/10 px-2 py-1 font-label text-label-sm uppercase text-emerald-400"
              : "rounded-full bg-surface-container-highest px-2 py-1 font-label text-label-sm uppercase text-on-surface-variant"
          }
        >
          {active ? "Ativo" : "Inativo"}
        </span>
      </div>
      {canManage ? (
        <div className="col-span-2 flex justify-end gap-1">
          <button
            className="rounded p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-primary disabled:opacity-50"
            disabled={isToggling}
            onClick={() =>
              startToggle(async () => {
                await toggleCategoryStatusAction(category.id, active ? "inactive" : "active");
              })
            }
            title={active ? "Desativar" : "Ativar"}
            type="button"
          >
            <span className="material-symbols-outlined text-[20px]">power_settings_new</span>
          </button>
          <CategoryFormDialog
            category={category}
            trigger={
              <span
                className="block rounded p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-primary"
                title="Editar"
              >
                <span className="material-symbols-outlined text-[20px]">edit</span>
              </span>
            }
          />
          <ConfirmDialog
            confirmLabel="Excluir"
            description={
              category.productCount > 0
                ? `"${category.name}" possui ${category.productCount} produto(s) vinculado(s) — remova ou reassocie os produtos antes de excluir.`
                : `Tem certeza que deseja excluir "${category.name}"? Essa ação não pode ser desfeita.`
            }
            onConfirm={() => deleteCategoryAction(category.id)}
            title="Excluir categoria"
            trigger={
              <span
                className="block rounded p-1.5 text-on-surface-variant transition-colors hover:bg-error-container/20 hover:text-error"
                title="Excluir"
              >
                <span className="material-symbols-outlined text-[20px]">delete</span>
              </span>
            }
          />
        </div>
      ) : null}
    </div>
  );
}
