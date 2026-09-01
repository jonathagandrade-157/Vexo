"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";

import { ProductGalleryUploader } from "@/components/painel/product-gallery-uploader";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { TextareaField } from "@/components/ui/textarea-field";
import { createProductAction, updateProductAction } from "@/features/products/actions";
import { initialProductState, type ProductGalleryImage } from "@/features/products/schema";

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
    /** D3.2-B Ponto 2A — kg/cm, fundação para uma futura cotação por transportadora. `null` = não informado (produtos antigos). */
    weight: number | null;
    height: number | null;
    width: number | null;
    length: number | null;
  };
  /** D13.1 — galeria já ordenada (primeira = principal). Só é buscada/passada quando `product` existe (mesma regra de sempre: imagem só na edição, nunca na criação — o path depende de um product_id real). */
  galleryImages?: ProductGalleryImage[];
}

/** Página dedicada (não modal) — igual ao padrão de `vexo_adicionar_produto_desktop` (Stitch), que mostra "Adicionar Produto" como página própria com "Voltar", diferente de categorias (modal inline). */
export function ProductForm({ categories, product, galleryImages }: ProductFormProps) {
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
              <ProductGalleryUploader initialImages={galleryImages ?? []} productId={product.id} />
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

          {/*
            D3.2-B Ponto 2A — todos opcionais, de propósito: um produto sem
            peso/dimensões continua válido em todo o resto do sistema (catálogo,
            carrinho, checkout, pedidos) — só fica de fora de uma futura cotação
            por transportadora enquanto esses campos não forem preenchidos. Sem
            `max`: nenhum teto foi confirmado nesta etapa (auditoria D3.2-B Ponto
            2A). `step="0.01"`/`"0.001"` permite casas decimais; `min="0.01"`/
            `"0.001"` só ajuda a UI a não sugerir 0 — a validação real (rejeitar
            0/negativo) é sempre do servidor (schema Zod + CHECK no banco), nunca
            só do navegador.
          */}
          <section className="rounded-lg border border-surface-container-highest bg-[#121212] p-6">
            <h2 className="mb-6 flex items-center gap-2 font-headline text-headline-sm text-on-surface">
              <span className="material-symbols-outlined text-primary">scale</span>
              Peso e dimensões
            </h2>
            <p className="mb-4 font-body text-body-sm text-on-surface-variant">
              Opcional. Usado futuramente para calcular o frete por transportadora.
            </p>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="font-label text-label-md uppercase text-on-surface-variant" htmlFor="weight">
                  Peso (kg)
                </label>
                <input
                  className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
                  defaultValue={product?.weight ?? undefined}
                  id="weight"
                  min="0.001"
                  name="weight"
                  placeholder="Ex: 0,50"
                  step="0.001"
                  type="number"
                />
                {state.fieldErrors?.weight ? <p className="text-label-sm text-error">{state.fieldErrors.weight}</p> : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="font-label text-label-md uppercase text-on-surface-variant" htmlFor="height">
                  Altura (cm)
                </label>
                <input
                  className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
                  defaultValue={product?.height ?? undefined}
                  id="height"
                  min="0.01"
                  name="height"
                  placeholder="Ex: 10,00"
                  step="0.01"
                  type="number"
                />
                {state.fieldErrors?.height ? <p className="text-label-sm text-error">{state.fieldErrors.height}</p> : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="font-label text-label-md uppercase text-on-surface-variant" htmlFor="width">
                  Largura (cm)
                </label>
                <input
                  className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
                  defaultValue={product?.width ?? undefined}
                  id="width"
                  min="0.01"
                  name="width"
                  placeholder="Ex: 15,00"
                  step="0.01"
                  type="number"
                />
                {state.fieldErrors?.width ? <p className="text-label-sm text-error">{state.fieldErrors.width}</p> : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="font-label text-label-md uppercase text-on-surface-variant" htmlFor="length">
                  Comprimento (cm)
                </label>
                <input
                  className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
                  defaultValue={product?.length ?? undefined}
                  id="length"
                  min="0.01"
                  name="length"
                  placeholder="Ex: 20,00"
                  step="0.01"
                  type="number"
                />
                {state.fieldErrors?.length ? <p className="text-label-sm text-error">{state.fieldErrors.length}</p> : null}
              </div>
            </div>
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
