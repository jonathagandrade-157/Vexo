/**
 * D12.2 — definição estática do wizard de onboarding, uma por
 * `business_type` (arquitetura recomendada em D12.1 §C/§G/§H). Código,
 * não dado de banco: mudar a ordem/conteúdo de um wizard é uma mudança de
 * produto, que deve passar por revisão de código como qualquer outra —
 * mesmo princípio já usado para `SEGMENT_OPTIONS`
 * (features/settings/segments.ts) e para as permission keys do projeto.
 *
 * `key` é sempre uma string estável, nunca um índice numérico (D12.2:
 * "as keys devem ser estáveis e sem depender de índices numéricos") — é o
 * que aparece na URL (`/onboarding/{key}`) e na PK de
 * `onboarding_progress.step_key`. Inserir/remover/reordenar um step nunca
 * exige renomear os já existentes.
 *
 * Só `ecommerce` tem uma definição nesta etapa (D12.2 — restaurant/adega
 * ficam para D12.3+, propositalmente ausentes do record abaixo em vez de
 * arrays vazios, para que `hasOnboardingWizard`/`getStepsForBusinessType`
 * consigam distinguir "não implementado ainda" de "implementado, zero
 * steps" sem um terceiro estado).
 */

/** `as const` (não uma anotação `readonly BusinessType[]`) de propósito — `z.enum` (features/onboarding/schema.ts) exige uma tupla de literais, não um array widened. */
export const BUSINESS_TYPES = ["restaurant", "adega", "ecommerce"] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];

/**
 * "data": a própria página do step tem um formulário que grava dado real
 *   (hoje só "seu-negocio" — nome/segmento/descrição/contato/business_type).
 * "orchestrated": o step não coleta dado dentro do wizard — ele orienta o
 *   lojista sobre uma área que já existe no painel normal
 *   (aparência/produtos/categorias/pagamentos/entrega) e só marca a
 *   etapa como confirmada quando o lojista clica em "Continuar"
 *   (`completeOnboardingStepAction`). D12.2 optou por este modelo em vez
 *   de embutir os formulários reais dessas áreas porque as Server
 *   Actions correspondentes (createProductAction, createCategoryAction,
 *   uploadStoreLogoAction, etc.) recusam qualquer operação enquanto
 *   `tenants.onboarding_completed_at` for NULL — exatamente o estado
 *   durante o wizard. Ver relatório D12.2 §Q (limitações) para os
 *   detalhes e o caminho recomendado para D12.3+.
 * "review": mostra uma pré-visualização real da loja (reaproveita
 *   `LivePreviewFrame`, mesmo mecanismo de `/painel/aparencia`) — funciona
 *   mesmo com zero produtos/categorias/pagamento/entrega configurados
 *   (D12.2.1: nenhuma dessas é pré-requisito).
 * "publish": etapa final — confirmar aqui é o que, junto com "seu-negocio"
 *   `completed` e toda outra etapa `required` já `completed` OU `skipped`
 *   (D12.2.1 — "skipped" satisfaz o requisito de progresso, nunca
 *   significa que a feature foi configurada), faz
 *   `recomputeOnboardingCompletion` preencher `onboarding_completed_at`.
 */
export type OnboardingStepKind = "data" | "orchestrated" | "review" | "publish";

export interface OnboardingStepDefinition {
  key: string;
  title: string;
  description: string;
  /** Precisa estar `completed` OU `skipped` (se `skippable`) para o onboarding poder ser concluído. */
  required: boolean;
  /**
   * D12.2.1 — se `true`, a etapa oferece "Pular por enquanto"
   * (`skipOnboardingStepAction`), e `status: "skipped"` conta como
   * resolvida para fins de conclusão do onboarding e de alcançabilidade
   * das etapas seguintes. Só `false` para "seu-negocio" (única etapa que
   * não pode ser pulada — prompt D12.2.1, "REGRA PRINCIPAL") e para
   * "revisar"/"publicar" (nada para pular ali: são só "Continuar").
   */
  skippable: boolean;
  kind: OnboardingStepKind;
  /** Só para etapas `skippable` — pergunta + explicação mostradas acima dos botões "Continuar"/"Pular por enquanto" (D12.2.1, seção UX). */
  prompt?: { headline: string; subtext: string; continueLabel: string };
}

const ECOMMERCE_STEPS: readonly OnboardingStepDefinition[] = [
  {
    key: "seu-negocio",
    title: "Seu negócio",
    description: "Conte um pouco sobre a sua marca.",
    required: true,
    skippable: false,
    kind: "data",
  },
  {
    key: "identidade",
    title: "Identidade da marca",
    description: "Logo, cores e modelo visual da sua loja.",
    required: true,
    skippable: true,
    kind: "orchestrated",
    prompt: {
      headline: "Quer personalizar a aparência da sua loja?",
      subtext: "Você pode fazer isso agora ou deixar para depois.",
      continueLabel: "Personalizar agora",
    },
  },
  {
    key: "produtos",
    title: "Produtos",
    description: "Cadastre os produtos que sua loja vai vender.",
    required: true,
    skippable: true,
    kind: "orchestrated",
    prompt: {
      headline: "Quer cadastrar seus primeiros produtos?",
      subtext: "Você pode fazer isso agora ou deixar para depois.",
      continueLabel: "Adicionar produtos à loja",
    },
  },
  {
    key: "categorias",
    title: "Categorias",
    description: "Organize seus produtos por categoria.",
    required: true,
    skippable: true,
    kind: "orchestrated",
    prompt: {
      headline: "Quer organizar seus produtos em categorias?",
      subtext: "Você pode fazer isso agora ou deixar para depois.",
      continueLabel: "Criar categorias",
    },
  },
  {
    key: "pagamentos",
    title: "Pagamentos",
    description: "Conecte um meio de pagamento para receber pelos pedidos.",
    required: true,
    skippable: true,
    kind: "orchestrated",
    prompt: {
      headline: "Quer configurar como seus clientes pagarão?",
      subtext: "Você pode fazer isso agora ou deixar para depois.",
      continueLabel: "Configurar pagamentos",
    },
  },
  {
    key: "entrega",
    title: "Entrega",
    description: "Configure como os clientes recebem os pedidos.",
    required: true,
    skippable: true,
    kind: "orchestrated",
    prompt: {
      headline: "Quer configurar entrega e retirada?",
      subtext: "Você pode fazer isso agora ou deixar para depois.",
      continueLabel: "Configurar agora",
    },
  },
  {
    key: "revisar",
    title: "Revisar loja",
    description: "Veja como sua loja vai ficar antes de publicar.",
    required: true,
    skippable: false,
    kind: "review",
  },
  {
    key: "publicar",
    title: "Publicar",
    description: "Deixe sua loja visível para os clientes.",
    required: true,
    skippable: false,
    kind: "publish",
  },
];

/**
 * Só `ecommerce` tem entrada — restaurant/adega ficam ausentes de
 * propósito (D12.2 não implementa o wizard deles). `Partial<Record<...>>`
 * (não `Record<...>` cheio) é o que torna essa ausência representável no
 * tipo, em vez de forçar um array vazio que se confundiria com "wizard
 * implementado, zero etapas".
 */
export const ONBOARDING_STEPS: Partial<Record<BusinessType, readonly OnboardingStepDefinition[]>> = {
  ecommerce: ECOMMERCE_STEPS,
};

export function isBusinessType(value: unknown): value is BusinessType {
  return typeof value === "string" && (BUSINESS_TYPES as readonly string[]).includes(value);
}

/** `null`/tipo sem wizard implementado → `[]`, nunca `undefined`/exceção — todo chamador pode tratar como "nenhuma etapa" sem checagem extra. */
export function getStepsForBusinessType(businessType: BusinessType | null): readonly OnboardingStepDefinition[] {
  if (!businessType) return [];
  return ONBOARDING_STEPS[businessType] ?? [];
}

export function hasOnboardingWizard(businessType: BusinessType | null): boolean {
  return getStepsForBusinessType(businessType).length > 0;
}
