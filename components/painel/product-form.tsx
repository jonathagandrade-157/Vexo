"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";

import { ProductImageUploader } from "@/components/painel/product-image-uploader";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { TextareaField } from "@/components/ui/textarea-field";
import { createProductAction, updateProductAction } from "@/features/products/actions";
import { initialProductState } from "@/features/products/schema";

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      className="flex items-center gap-2 rounded-lg bg-primary-container px-6 py-3 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
        save
      </span>
      {pending ? "Salvando…" : label}
    </button>
  );
}

interface ProductFormProps {
  categories: { id: string; name: string }[];
  product?: {
    id: string;
    name: string;
    description: string | null;
    price: number;
    promotional_price: number | null;
    sku: string | null;
    category_id: string | null;
    main_image: string | null;
  };
}

/** Página dedicada (não modal) — igual ao padrão de `vexo_adicionar_produto_desktop` (Stitch), que mostra "Adicionar Produto" como página própria com "Voltar", diferente de categorias (modal inline). */
export function ProductForm({ categories, product }: ProductFormProps) {
  const action = product ? updateProductAction : createProductAction;
  const [state, formAction] = useActionState(action, initialProductState);

  return (
    <form action={formAction} noValidate>
      {product ? <input name="productId" type="hidden" value={product.id} /> : null}

      <div className="sticky top-16 z-10 -mx-margin-mobile mb-8 flex items-center justify-between gap-4 border-b border-outline-variant bg-surface/95 px-margin-mobile py-4 backdrop-blur-md md:-mx-margin-desktop md:px-margin-desktop">
        <div className="flex items-center gap-4">
          <Link className="flex items-center gap-1 text-on-surface-variant transition-colors hover:text-primary" href="/painel/produtos">
            <span className="material-symbols-outlined text-xl">arrow_back</span>
            <span className="font-label text-label-md">Voltar</span>
          </Link>
          <div className="hidden h-6 w-px bg-outline-variant md:block" />
          <h1 className="hidden font-headline text-headline-sm text-on-surface md:block">
            {product ? "Editar produto" : "Adicionar produto"}
          </h1>
        </div>
        <SaveButton label={product ? "Salvar alterações" : "Salvar produto"} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <section className="rounded-lg border border-surface-container-highest bg-[#121212] p-6">
            <h2 className="mb-6 flex items-center gap-2 font-headline text-headline-sm text-on-surface">
              <span className="material-symbols-outlined text-primary">info</span>
              Informações básicas
            </h2>
            <div className="flex flex-col gap-4">
              <TextField
                defaultValue={product?.name}
                error={state.fieldErrors?.name}
                icon="inventory_2"
                id="name"
                label="Nome do produto"
                name="name"
                placeholder="Ex: Camiseta Premium Algodão"
              />
              <TextareaField
                defaultValue={product?.description ?? undefined}
                error={state.fieldErrors?.description}
                id="description"
                label="Descrição"
                name="description"
                rows={5}
              />
              <SelectField
                defaultValue={product?.category_id ?? ""}
                error={state.fieldErrors?.categoryId}
                id="categoryId"
                label="Categoria"
                name="categoryId"
                options={[{ value: "", label: "Sem categoria" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
                placeholder="Selecione uma categoria"
              />
            </div>
          </section>

          <section className="rounded-lg border border-surface-container-highest bg-[#121212] p-6">
            <h2 className="mb-6 flex items-center gap-2 font-headline text-headline-sm text-on-surface">
              <span className="material-symbols-outlined text-primary">image</span>
              Mídia
            </h2>
            {product ? (
              <ProductImageUploader initialImagePath={product.main_image} productId={product.id} />
            ) : (
              <p className="font-body text-body-sm text-on-surface-variant">
                Salve o produto primeiro para adicionar uma imagem — a próxima tela já abre pronta para isso.
              </p>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <section className="rounded-lg border border-surface-container-highest bg-[#121212] p-6">
            <h2 className="mb-6 flex items-center gap-2 font-headline text-headline-sm text-on-surface">
              <span className="material-symbols-outlined text-primary">payments</span>
              Precificação
            </h2>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="font-label text-label-md uppercase text-on-surface-variant" htmlFor="price">
                  Preço de venda
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-label text-label-md text-on-surface-variant">
                    R$
                  </span>
                  <input
                    className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest py-2.5 pl-10 pr-3 font-body text-body-sm text-on-surface focus:outline-none"
                    defaultValue={product?.price}
                    id="price"
                    min="0"
                    name="price"
                    placeholder="0,00"
                    required
                    step="0.01"
                    type="number"
                  />
                </div>
                {state.fieldErrors?.price ? (
                  <p className="text-label-sm text-error">{state.fieldErrors.price}</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="font-label text-label-md uppercase text-on-surface-variant" htmlFor="promotionalPrice">
                  Preço promocional (opcional)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-label text-label-md text-on-surface-variant">
                    R$
                  </span>
                  <input
                    className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest py-2.5 pl-10 pr-3 font-body text-body-sm text-on-surface focus:outline-none"
                    defaultValue={product?.promotional_price ?? undefined}
                    id="promotionalPrice"
                    min="0"
                    name="promotionalPrice"
                    placeholder="0,00"
                    step="0.01"
                    type="number"
                  />
                </div>
                {state.fieldErrors?.promotionalPrice ? (
                  <p className="text-label-sm text-error">{state.fieldErrors.promotionalPrice}</p>
                ) : null}
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-surface-container-highest bg-[#121212] p-6">
            <h2 className="mb-6 flex items-center gap-2 font-headline text-headline-sm text-on-surface">
              <span className="material-symbols-outlined text-primary">tag</span>
              SKU
            </h2>
            <TextField
              defaultValue={product?.sku ?? undefined}
              error={state.fieldErrors?.sku}
              icon="qr_code_2"
              id="sku"
              label="SKU (opcional)"
              name="sku"
              placeholder="Ex: CAM-PRM-ALG"
            />
          </section>
        </div>
      </div>

      {state.status === "error" && state.message ? (
        <p className="mt-6 rounded-lg border border-error/30 bg-error-container/10 px-4 py-2 font-body text-body-sm text-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
