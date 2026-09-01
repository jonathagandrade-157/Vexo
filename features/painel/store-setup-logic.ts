import type { BusinessType } from "@/features/onboarding/step-definitions";

/**
 * D12.2.2 — checklist de configuração do painel. Deliberadamente
 * INDEPENDENTE do motor de onboarding (D12.2/D12.2.1): não lê
 * `onboarding_progress`, não usa `completed`/`skipped` — o estado aqui é
 * sempre derivado de dado real das próprias tabelas de negócio
 * (tenants/products/categories/store_payment_providers/shipping_*), nunca
 * do que o lojista respondeu no wizard. Um lojista que pulou "Produtos"
 * no onboarding e depois cadastra um produto pelo painel normal já vê o
 * item "Produtos" concluído aqui, mesmo sem nunca ter voltado ao
 * onboarding — é exatamente esse o papel do checklist (orientação
 * contínua, não uma segunda cópia do onboarding).
 *
 * Toda a determinação de "está concluído?" vive nestas funções puras
 * (sem `supabase`, sem React) — testável sem banco, mesmo princípio já
 * usado em `features/onboarding/progress-logic.ts`. Quem busca os sinais
 * brutos no Postgres é `store-setup.ts` ("server-only").
 */

export interface StoreSetupRawSignals {
  storeName: string;
  segment: string | null;
  instagramHandle: string | null;
  whatsappPhone: string | null;
  contactEmail: string | null;
  logoUrl: string | null;
  productCount: number;
  categoryCount: number;
  paymentConnected: boolean;
  shippingEnabled: boolean;
  activeShippingMethodCount: number;
}

function nonEmpty(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** "Informações da loja" — os mesmos campos que a etapa "seu-negocio" do onboarding já exige (D12.2), nunca uma regra nova/paralela: nome, segmento, Instagram, WhatsApp, e-mail. `description` fica de fora — é o único campo opcional lá. */
export function hasMinimumStoreInfo(
  raw: Pick<StoreSetupRawSignals, "storeName" | "segment" | "instagramHandle" | "whatsappPhone" | "contactEmail">,
): boolean {
  return (
    nonEmpty(raw.storeName) &&
    nonEmpty(raw.segment) &&
    nonEmpty(raw.instagramHandle) &&
    nonEmpty(raw.whatsappPhone) &&
    nonEmpty(raw.contactEmail)
  );
}

/** "Identidade" — sinal mínimo de personalização deliberada: uma logo enviada. Cores/modelo sempre têm um valor padrão (nunca "vazios" de verdade), então checá-los seria um sinal fraco — enviar uma logo é uma ação explícita real. */
export function hasIdentityConfigured(raw: Pick<StoreSetupRawSignals, "logoUrl">): boolean {
  return nonEmpty(raw.logoUrl);
}

export function hasProducts(raw: Pick<StoreSetupRawSignals, "productCount">): boolean {
  return raw.productCount > 0;
}

export function hasCategories(raw: Pick<StoreSetupRawSignals, "categoryCount">): boolean {
  return raw.categoryCount > 0;
}

export function hasPaymentConfigured(raw: Pick<StoreSetupRawSignals, "paymentConnected">): boolean {
  return raw.paymentConnected;
}

/** Mesmo critério que a policy pública de `shipping_methods` usa para decidir se o frete é visível/funcional no storefront (migration 20260817220046): entrega habilitada E pelo menos uma modalidade ativa. */
export function hasShippingConfigured(raw: Pick<StoreSetupRawSignals, "shippingEnabled" | "activeShippingMethodCount">): boolean {
  return raw.shippingEnabled && raw.activeShippingMethodCount > 0;
}

export interface StoreSetupItem {
  key: string;
  title: string;
  description: string;
  completed: boolean;
  href: string;
  actionLabel: string;
}

export interface StoreSetupChecklist {
  items: StoreSetupItem[];
  completedCount: number;
  totalCount: number;
  /** 0–100, arredondado — sempre `completedCount / totalCount`, nunca uma coluna persistida (D12.2.2: "não criar coluna setup_percentage"). */
  percentage: number;
  allComplete: boolean;
}

interface ItemCopy {
  key: string;
  notDoneTitle: string;
  notDoneDescription: string;
  doneTitle: string;
  doneDescription: string;
  href: string;
  actionLabel: string;
}

/** Copy do item "Produtos" varia por `business_type` (D12.2.2 §4) — só apresentação, nenhuma estrutura nova. `null`/tipo sem wizard implementado (hoje só `ecommerce` tem) cai no texto de ecommerce, mesmo fallback já usado no motor de onboarding. */
export function productsCopy(businessType: BusinessType | null, hasAnyProduct: boolean): ItemCopy {
  const href = hasAnyProduct ? "/painel/produtos" : "/painel/produtos/novo";

  if (businessType === "restaurant") {
    return {
      key: "produtos",
      notDoneTitle: "Adicione seus primeiros pratos",
      notDoneDescription: "Cadastre os pratos do seu cardápio para começar a montar sua loja.",
      doneTitle: "Cardápio",
      doneDescription: "Você já cadastrou seus pratos.",
      href,
      actionLabel: "Cadastrar prato",
    };
  }
  if (businessType === "adega") {
    return {
      key: "produtos",
      notDoneTitle: "Adicione seus primeiros produtos",
      notDoneDescription: "Cadastre os produtos do seu catálogo para começar a montar sua loja.",
      doneTitle: "Produtos",
      doneDescription: "Você já cadastrou seus produtos.",
      href,
      actionLabel: "Cadastrar produto",
    };
  }
  return {
    key: "produtos",
    notDoneTitle: "Cadastre seu primeiro produto",
    notDoneDescription: "Adicione produtos para começar a montar sua loja.",
    doneTitle: "Produtos",
    doneDescription: "Você já cadastrou seus produtos.",
    href,
    actionLabel: "Cadastrar produto",
  };
}

const STATIC_ITEM_COPY: readonly Omit<ItemCopy, "href">[] = [
  {
    key: "informacoes",
    notDoneTitle: "Complete as informações da loja",
    notDoneDescription: "Preencha nome, segmento, Instagram, WhatsApp e e-mail de contato.",
    doneTitle: "Informações da loja",
    doneDescription: "Configuração concluída.",
    actionLabel: "Editar informações",
  },
  {
    key: "identidade",
    notDoneTitle: "Personalize sua loja",
    notDoneDescription: "Adicione sua identidade visual e deixe sua loja com a sua cara.",
    doneTitle: "Identidade da loja",
    doneDescription: "Configuração concluída.",
    actionLabel: "Personalizar loja",
  },
  {
    key: "categorias",
    notDoneTitle: "Organize seus produtos em categorias",
    notDoneDescription: "Categorias ajudam seus clientes a encontrar produtos mais rápido.",
    doneTitle: "Categorias",
    doneDescription: "Configuração concluída.",
    actionLabel: "Criar categoria",
  },
  {
    key: "pagamentos",
    notDoneTitle: "Configure os pagamentos",
    notDoneDescription: "Escolha como seus clientes poderão pagar.",
    doneTitle: "Pagamentos",
    doneDescription: "Configuração concluída.",
    actionLabel: "Configurar pagamentos",
  },
  {
    key: "entrega",
    notDoneTitle: "Configure a entrega",
    notDoneDescription: "Defina como seus clientes receberão os pedidos.",
    doneTitle: "Entrega",
    doneDescription: "Configuração concluída.",
    actionLabel: "Configurar entrega",
  },
] as const;

const STATIC_ITEM_HREFS: Record<string, string> = {
  informacoes: "/painel/configuracoes",
  identidade: "/painel/aparencia",
  categorias: "/painel/categorias",
  pagamentos: "/painel/configuracoes/pagamentos",
  entrega: "/painel/configuracoes/entrega",
};

function resolveItem(copy: ItemCopy, completed: boolean): StoreSetupItem {
  return {
    key: copy.key,
    title: completed ? copy.doneTitle : copy.notDoneTitle,
    description: completed ? copy.doneDescription : copy.notDoneDescription,
    completed,
    href: copy.href,
    actionLabel: copy.actionLabel,
  };
}

/**
 * Único ponto que monta o checklist a partir dos sinais brutos —
 * separado da apresentação (`components/painel/store-setup-checklist.tsx`
 * só lê `StoreSetupItem[]`, nunca decide "concluído ou não" sozinho).
 * Sinal ausente/zerado nunca lança exceção — cada função `hasX` acima
 * trata a ausência como "não concluído", nunca quebra o cálculo do
 * restante (D12.2.2 §16, "itens opcionais/indisponíveis não devem
 * quebrar o cálculo").
 */
export function buildStoreSetupChecklist(raw: StoreSetupRawSignals, businessType: BusinessType | null): StoreSetupChecklist {
  const completion: Record<string, boolean> = {
    informacoes: hasMinimumStoreInfo(raw),
    identidade: hasIdentityConfigured(raw),
    produtos: hasProducts(raw),
    categorias: hasCategories(raw),
    pagamentos: hasPaymentConfigured(raw),
    entrega: hasShippingConfigured(raw),
  };

  const produtos = productsCopy(businessType, raw.productCount > 0);

  const staticItems = STATIC_ITEM_COPY.map((copy) =>
    resolveItem({ ...copy, href: STATIC_ITEM_HREFS[copy.key]! }, completion[copy.key]!),
  );

  // Ordem fixa da seção 2 (D12.2.2): Informações, Identidade, Produtos, Categorias, Pagamentos, Entrega.
  const items: StoreSetupItem[] = [
    staticItems[0]!,
    staticItems[1]!,
    resolveItem(produtos, completion.produtos!),
    staticItems[2]!,
    staticItems[3]!,
    staticItems[4]!,
  ];

  const completedCount = items.filter((i) => i.completed).length;
  const totalCount = items.length;
  const percentage = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);

  return {
    items,
    completedCount,
    totalCount,
    percentage,
    allComplete: totalCount > 0 && completedCount === totalCount,
  };
}

/** Real e conhecida no momento de renderizar (mesmo padrão de `/painel/aparencia`: `href={`/loja/${tenant.slug}`}`) — nunca inventada. */
export function storefrontHref(storeSlug: string): string {
  return `/loja/${storeSlug}`;
}
