"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ProductGalleryUploader } from "@/components/painel/product-gallery-uploader";
import { ProductOptionsEditor } from "@/components/painel/product-options-editor";
import { VariantsTable } from "@/components/painel/variants-table";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { TextareaField } from "@/components/ui/textarea-field";
import { createProductAction, updateProductAction } from "@/features/products/actions";
import {
  emptyStagedConfigProgress,
  persistStagedProductConfiguration,
  type StagedConfigProgress,
} from "@/features/products/persist-staged-configuration";
import { computeSaveStatus, isCriticalSaveInProgress, saveButtonLabel } from "@/features/products/save-status";
import { initialProductState, type ProductGalleryImage } from "@/features/products/schema";
import type { ProductOptionWithValues, ProductVariantRow } from "@/features/products/variants-data";

type ConfigPersistStatus = "idle" | "pending" | "success" | "error";

function SaveButton({ label, disabled }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      className="flex items-center gap-2 rounded-lg bg-primary-container px-6 py-3 font-label text-label-md text-on-primary-container transition-colors hover:bg-primary-container/90 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending || disabled}
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
  /** D19.1.2 — `null` = "estoque não controlado ainda" (D19.1.1 §8), nunca 0/ilimitado — os campos ficam em branco, nunca pré-preenchidos com um valor inventado. */
  inventory?: { stock_quantity: number; low_stock_threshold: number | null } | null;
  /** D20.6 Fase 3.3 — opções+valores já cadastrados, mesma regra de galleryImages: só existe quando `product` existe (opções são configuradas depois do produto salvo, nunca na criação). */
  initialOptions?: ProductOptionWithValues[];
  /** D20.6 Fase 3.3 — variantes já geradas, mesma regra acima. */
  initialVariants?: ProductVariantRow[];
}

/** Página dedicada (não modal) — igual ao padrão de `vexo_adicionar_produto_desktop` (Stitch), que mostra "Adicionar Produto" como página própria com "Voltar", diferente de categorias (modal inline). */
export function ProductForm({ categories, product, galleryImages, inventory, initialOptions, initialVariants }: ProductFormProps) {
  const router = useRouter();
  const action = product ? updateProductAction : createProductAction;
  const [state, formAction] = useActionState(action, initialProductState);

  // D20.7 — id do produto para o resto do formulário usar: o já existente
  // (edição), ou o que `createProductAction` acabou de devolver (criação
  // recém-concluída nesta mesma instância do componente — a Action não
  // redireciona mais sozinha, ver features/products/actions.ts). Nenhuma
  // navegação de página acontece só por causa disso — é o que permite
  // `ProductGalleryUploader`/`ProductOptionsEditor`/`VariantsTable`
  // continuarem com os MESMOS dados staged (um `File` selecionado, ou
  // opções/valores/variantes montados em memória) já preenchidos.
  const effectiveProductId = product?.id ?? (state.status === "success" ? state.productId : undefined);
  const justCreated = !product && state.status === "success" && Boolean(state.productId);
  const hasNavigatedRef = useRef(false);
  const [gallerySettled, setGallerySettled] = useState(false);
  const [galleryUploadsHadFailure, setGalleryUploadsHadFailure] = useState(false);

  // D20.6 Fase 3.3 — estado "levantado" para ProductForm: ProductOptionsEditor
  // e VariantsTable são dois componentes independentes (cada um com seu
  // próprio useState interno, Fases 3.1/3.2), mas VariantsTable precisa do
  // nome/posição ATUAL de cada opção/valor para montar o rótulo da
  // combinação (ex.: "Preto / P"). Sem isto, renomear um valor em
  // ProductOptionsEditor e gerar variantes na sequência mostraria o rótulo
  // antigo até a página recarregar — nunca um bug de dado (a geração no
  // servidor sempre lê o estado real do banco), só um rótulo desatualizado
  // na tela. `onOptionsChange` (Fase 3.3, prop opcional/aditiva) mantém as
  // duas visões sincronizadas sem precisar de contexto/store global.
  //
  // D20.8 — a MESMA lista `options` agora também serve de estado staged
  // (opções/valores montados ANTES do primeiro save, quando `product` é
  // undefined): `ProductOptionsEditor`/`VariantsTable` decidem sozinhos,
  // por `productId`, se leem/escrevem via Server Action ou só localmente
  // (nunca uma segunda árvore de estado paralela). `stagedVariants` é o
  // equivalente para a tabela de variantes — só relevante antes do save,
  // vazio depois (a edição usa `initialVariants`, sem mudança).
  const [options, setOptions] = useState<ProductOptionWithValues[]>(initialOptions ?? []);
  const [stagedVariants, setStagedVariants] = useState<ProductVariantRow[]>([]);

  // D20.8 — preço do produto precisa estar disponível em JS (não só no
  // DOM) para semear o preço-padrão de uma variante staged recém-gerada
  // (mesma regra de generateProductVariantsAction: preço da variante nova
  // = preço do produto) — único campo do formulário que passa a ser
  // controlado por esse motivo; todos os outros continuam `defaultValue`
  // (não controlados), sem mudança de comportamento.
  const [priceValue, setPriceValue] = useState(product?.price !== undefined ? String(product.price) : "");
  const defaultVariantPrice = Number(priceValue.replace(",", ".")) || 0;

  const [configPersistState, setConfigPersistState] = useState<{
    status: ConfigPersistStatus;
    message?: string;
    progress: StagedConfigProgress;
  }>({ status: "idle", progress: emptyStagedConfigProgress() });

  // D20.8/D20.7 — refs (não state) para as duas condições de "pode
  // navegar": lidas dentro de callbacks assíncronos que podem retomar
  // depois de várias renderizações (mesmo motivo de hasNavigatedRef já
  // existente) — um `useState` lido por uma closure antiga poderia ficar
  // desatualizado; um ref lido a qualquer momento reflete sempre o valor
  // mais recente.
  const gallerySettledRef = useRef(false);
  const galleryHasFailureRef = useRef(false);
  const configStatusRef = useRef<ConfigPersistStatus>("idle");

  /** D20.7/D20.8 — só navega quando TODO staging pendente (imagens E opções/valores/variantes) chegou a um estado terminal sem falha — nunca antes, nunca com uma falha pendente (o lojista precisa ver o que falhou e poder tentar de novo, ainda nesta tela). */
  function attemptNavigate() {
    if (hasNavigatedRef.current || !effectiveProductId) return;
    if (!gallerySettledRef.current || galleryHasFailureRef.current) return;
    if (configStatusRef.current === "pending" || configStatusRef.current === "error") return;
    hasNavigatedRef.current = true;
    router.push(`/painel/produtos/${effectiveProductId}/editar`);
  }

  /** D20.7 — chamado toda vez que uma rodada de envio dos arquivos pendentes de ProductGalleryUploader termina. */
  function handleGalleryUploadsSettled({ hasPending }: { hasPending: boolean }) {
    gallerySettledRef.current = true;
    galleryHasFailureRef.current = hasPending;
    setGallerySettled(true);
    setGalleryUploadsHadFailure(hasPending);
    attemptNavigate();
  }

  /**
   * D20.8 — depois que `createProductAction` devolve um `productId` real,
   * persiste as opções/valores/variantes staged usando as MESMAS Server
   * Actions de D20.6 (persist-staged-configuration.ts). Nunca recria o
   * produto (ele já existe); numa falha, o progresso já feito fica
   * guardado em `configPersistState.progress` — uma nova chamada com o
   * MESMO progress (retry, "Tentar novamente") pula tudo que já foi
   * persistido, nunca duplica nada.
   */
  async function runConfigPersistence(pid: string) {
    if (options.length === 0) {
      configStatusRef.current = "success";
      setConfigPersistState((s) => ({ ...s, status: "success", message: undefined }));
      attemptNavigate();
      return;
    }

    configStatusRef.current = "pending";
    setConfigPersistState((s) => ({ ...s, status: "pending", message: undefined }));
    const result = await persistStagedProductConfiguration({
      productId: pid,
      stagedOptions: options,
      stagedVariants,
      progress: configPersistState.progress,
    });
    configStatusRef.current = result.status;
    setConfigPersistState({ status: result.status, message: result.message, progress: result.progress });
    attemptNavigate();
  }

  function handleRetryConfigPersistence() {
    if (!effectiveProductId) return;
    void runConfigPersistence(effectiveProductId);
  }

  const previousProductIdForConfigRef = useRef(effectiveProductId);
  useEffect(() => {
    if (effectiveProductId && !previousProductIdForConfigRef.current) {
      void runConfigPersistence(effectiveProductId);
    }
    previousProductIdForConfigRef.current = effectiveProductId;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dispara só na transição undefined→definido (guardada por previousProductIdForConfigRef); `options`/`stagedVariants`/`runConfigPersistence` de propósito fora das deps, a leitura relevante é sempre a do render corrente (mesmo padrão do efeito de transição de productId em ProductGalleryUploader, D20.7).
  }, [effectiveProductId]);

  // D20.9.1 — B1: "Produto salvo" só é verdade depois que imagens (D20.7) E
  // opções/valores/variantes (D20.8) terminam, nunca só porque
  // createProductAction retornou sucesso — ver features/products/
  // save-status.ts para a derivação em si (pura, testada isoladamente).
  const saveStatus = computeSaveStatus({
    isEditMode: Boolean(product),
    justCreated,
    gallerySettled,
    galleryHasFailure: galleryUploadsHadFailure,
    configStatus: configPersistState.status,
  });
  const isSavingCritically = isCriticalSaveInProgress(saveStatus);

  // D20.9.1 — B2: enquanto a persistência crítica pós-criação estiver em
  // andamento (opções/valores/variantes/imagens ainda salvando), um
  // fechamento de aba/reload/navegação para outro site precisa de uma
  // confirmação explícita do navegador — `beforeunload` nunca dispara para
  // uma navegação client-side do próprio Next.js (router.push), só para
  // sair do app de verdade, então nunca interfere no redirect automático
  // de `attemptNavigate` quando tudo terminar com sucesso. Mensagem
  // customizada não é garantida por nenhum navegador moderno (todos usam o
  // texto padrão deles) — `event.preventDefault()`/`returnValue` é o
  // suficiente para acionar esse prompt nativo.
  useEffect(() => {
    if (!isSavingCritically) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isSavingCritically]);

  /** D20.9.1 — B2: navegação interna controlada pelo próprio app (o único link "Voltar" deste formulário) — intercepta e confirma com o lojista antes de sair, só enquanto `isSavingCritically`. Fora desse estado, o Link navega normalmente, sem nenhuma mudança de comportamento. */
  function handleBackLinkClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!isSavingCritically) return;
    event.preventDefault();
    const confirmed = window.confirm("Este produto ainda está sendo salvo. Deseja realmente sair?");
    if (confirmed) router.push("/painel/produtos");
  }

  return (
    <form action={formAction} noValidate>
      {product ? <input name="productId" type="hidden" value={product.id} /> : null}

      <div className="sticky top-16 z-10 -mx-margin-mobile mb-8 flex items-center justify-between gap-4 border-b border-outline-variant bg-surface/95 px-margin-mobile py-4 backdrop-blur-md md:-mx-margin-desktop md:px-margin-desktop">
        <div className="flex items-center gap-4">
          <Link
            className="flex items-center gap-1 text-on-surface-variant transition-colors hover:text-primary"
            href="/painel/produtos"
            onClick={handleBackLinkClick}
          >
            <span className="material-symbols-outlined text-xl">arrow_back</span>
            <span className="font-label text-label-md">Voltar</span>
          </Link>
          <div className="hidden h-6 w-px bg-outline-variant md:block" />
          <h1 className="hidden font-headline text-headline-sm text-on-surface md:block">
            {product ? "Editar produto" : "Adicionar produto"}
          </h1>
        </div>
        {/* D20.7 — depois de criado, o form continua montado (mesma instância, sem navegar) só para terminar o upload das imagens já selecionadas/a persistência de opções/valores/variantes (D20.8): reenviar o form chamaria createProductAction de novo, criando um SEGUNDO produto. O botão fica desabilitado até a navegação para a tela de edição de verdade acontecer. D20.9.1 — o rótulo agora reflete os 3 estados possíveis pós-criação (salvando/falhou/salvo), nunca "Produto salvo" antes de tudo terminar de verdade. */}
        <SaveButton disabled={justCreated} label={saveButtonLabel(saveStatus)} />
      </div>

      {/* D20.9.1 — B1: feedback visual explícito, distinto do rótulo do botão, enquanto imagens/opções/valores/variantes ainda estão sendo persistidas depois da criação do produto. */}
      {isSavingCritically ? (
        <div className="-mt-4 mb-6 flex items-center gap-2 rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-4 py-2" role="status">
          <span className="material-symbols-outlined animate-spin text-[18px] text-primary">progress_activity</span>
          <p className="font-body text-body-sm text-on-surface-variant">
            Salvando produto — imagens, opções e variantes ainda estão sendo configuradas. Não feche nem saia desta página.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <section className="rounded-lg border border-surface-container-highest bg-surface-container-lowest p-6">
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

          <section className="rounded-lg border border-surface-container-highest bg-surface-container-lowest p-6">
            <h2 className="mb-6 flex items-center gap-2 font-headline text-headline-sm text-on-surface">
              <span className="material-symbols-outlined text-primary">image</span>
              Mídia
            </h2>
            {/*
              D20.7 — antes só disponível na edição (o path do Storage
              dependia de um product_id real). Agora sempre renderizado:
              sem produto ainda, `ProductGalleryUploader` guarda os
              arquivos localmente (preview, reorder, principal, tudo sem
              rede); assim que `effectiveProductId` existir (produto
              criado nesta mesma instância do formulário, sem navegar), o
              próprio componente envia o que foi selecionado.
            */}
            <ProductGalleryUploader
              initialImages={galleryImages ?? []}
              onUploadsSettled={!product ? handleGalleryUploadsSettled : undefined}
              productId={effectiveProductId}
            />
            {justCreated && galleryUploadsHadFailure ? (
              <p className="mt-3 font-body text-body-sm text-on-surface-variant" role="status">
                Produto criado, mas algumas imagens não foram enviadas — veja acima.
              </p>
            ) : null}
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <section className="rounded-lg border border-surface-container-highest bg-surface-container-lowest p-6">
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
                    id="price"
                    min="0"
                    name="price"
                    onChange={(e) => setPriceValue(e.target.value)}
                    placeholder="0,00"
                    required
                    step="0.01"
                    type="number"
                    value={priceValue}
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

          <section className="rounded-lg border border-surface-container-highest bg-surface-container-lowest p-6">
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
            D19.1.2 — ambos opcionais, de propósito: deixar em branco
            (na criação, ou apagando o valor na edição) significa "não
            controlar estoque deste produto" (D19.1.1 §8) — o produto
            continua vendendo normalmente, sem checagem nenhuma. Só
            preencher `stockQuantity` liga o controle real (checagem +
            decremento atômico no checkout).
          */}
          <section className="rounded-lg border border-surface-container-highest bg-surface-container-lowest p-6">
            <h2 className="mb-6 flex items-center gap-2 font-headline text-headline-sm text-on-surface">
              <span className="material-symbols-outlined text-primary">inventory</span>
              Estoque
            </h2>
            <p className="mb-4 font-body text-body-sm text-on-surface-variant">
              Opcional. Deixe em branco para não controlar o estoque deste produto.
            </p>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="font-label text-label-md uppercase text-on-surface-variant" htmlFor="stockQuantity">
                  Quantidade em estoque
                </label>
                <input
                  className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
                  defaultValue={inventory?.stock_quantity}
                  id="stockQuantity"
                  min="0"
                  name="stockQuantity"
                  placeholder="Ex: 20"
                  step="1"
                  type="number"
                />
                {state.fieldErrors?.stockQuantity ? (
                  <p className="text-label-sm text-error">{state.fieldErrors.stockQuantity}</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="font-label text-label-md uppercase text-on-surface-variant" htmlFor="lowStockThreshold">
                  Avisar quando o estoque atingir (opcional)
                </label>
                <input
                  className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
                  defaultValue={inventory?.low_stock_threshold ?? undefined}
                  id="lowStockThreshold"
                  min="0"
                  name="lowStockThreshold"
                  placeholder="Ex: 5"
                  step="1"
                  type="number"
                />
                {state.fieldErrors?.lowStockThreshold ? (
                  <p className="text-label-sm text-error">{state.fieldErrors.lowStockThreshold}</p>
                ) : null}
              </div>
            </div>
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
          <section className="rounded-lg border border-surface-container-highest bg-surface-container-lowest p-6">
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

      {/*
        D20.8 — antes só disponível na edição (as linhas de
        product_options/product_variants dependiam de um product_id
        real). Agora sempre renderizado: sem produto ainda,
        `ProductOptionsEditor`/`VariantsTable` guardam opções/valores/
        variantes localmente (`options`/`stagedVariants` acima); assim
        que `effectiveProductId` existir (produto criado nesta mesma
        instância do formulário, sem navegar), a persistência roda
        automaticamente (`runConfigPersistence`) usando as mesmas Server
        Actions de sempre.
      */}
      <section className="mt-6 rounded-lg border border-surface-container-highest bg-surface-container-lowest p-6">
        <h2 className="mb-2 flex items-center gap-2 font-headline text-headline-sm text-on-surface">
          <span className="material-symbols-outlined text-primary">tune</span>
          Opções do produto
        </h2>
        <p className="mb-6 font-body text-body-sm text-on-surface-variant">
          Opcional. Adicione opções e valores para gerar automaticamente as variações deste produto — produtos simples, sem nenhuma
          opção, continuam funcionando exatamente como antes.
        </p>
        <ProductOptionsEditor
          initialOptions={options}
          onOptionsChange={setOptions}
          onStagedOptionsChange={setOptions}
          productId={product?.id}
          stagedOptions={options}
        />
      </section>

      <section className="mt-6 rounded-lg border border-surface-container-highest bg-surface-container-lowest p-6">
        <VariantsTable
          defaultPrice={defaultVariantPrice}
          initialOptions={options}
          initialVariants={initialVariants ?? []}
          onVariantsChange={setStagedVariants}
          productId={product?.id}
          variants={stagedVariants}
        />
      </section>

      {/* D20.8 — só depois de uma criação (justCreated): o produto já existe (nunca é recriado/apagado por isto), mas a configuração de opções/valores/variantes staged ainda não foi concluída — nunca escondido, sempre com um jeito de tentar de novo ou seguir para a edição manualmente. */}
      {justCreated && configPersistState.status === "error" ? (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-error/30 bg-error-container/10 px-4 py-2">
          <p className="font-body text-body-sm text-error" role="alert">
            Produto criado, mas a configuração de opções/variantes não foi concluída — {configPersistState.message ?? "tente novamente."}
          </p>
          <button
            className="font-label text-label-sm text-error underline"
            onClick={handleRetryConfigPersistence}
            type="button"
          >
            Tentar novamente
          </button>
          {effectiveProductId ? (
            <Link className="font-label text-label-sm text-primary underline" href={`/painel/produtos/${effectiveProductId}/editar`}>
              Ir para edição agora
            </Link>
          ) : null}
        </div>
      ) : null}

      {state.status === "error" && state.message ? (
        <p className="mt-6 rounded-lg border border-error/30 bg-error-container/10 px-4 py-2 font-body text-body-sm text-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
