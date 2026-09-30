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
 * Só `ecommerce` pertence ao produto VEXO. Os demais valores permanecem
 * no tipo por compatibilidade com dados legados, sem wizard nem opção na
 * interface.
 */

/** `as const` (não uma anotação `readonly BusinessType[]`) de propósito — `z.enum` (features/onboarding/schema.ts) exige uma tupla de literais, não um array widened. */
export const BUSINESS_TYPES = ["restaurant", "adega", "ecommerce"] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];

/**
 * "data": a própria página do step tem um formulário que grava dado real
 *   ("segmento" grava business_type; "seu-negocio" grava os dados da marca).
 * "review": mostra uma pré-visualização real da loja (reaproveita
 *   `LivePreviewFrame`, mesmo mecanismo de `/painel/aparencia`) — funciona
 *   mesmo com zero produtos/categorias/pagamento/entrega configurados
 *   (D12.2.1: nenhuma dessas é pré-requisito).
 * "publish": etapa final — confirmar aqui é o que, junto com todas as
 *   etapas anteriores resolvidas (`completed` ou `skipped`, quando a
 *   definição permitir), faz
 *   `recomputeOnboardingCompletion` preencher `onboarding_completed_at`.
 */
export type OnboardingStepKind = "data" | "review" | "publish";

export interface OnboardingStepDefinition {
  key: string;
  title: string;
  description: string;
  /** Precisa estar resolvida para o onboarding poder ser concluído. */
  required: boolean;
  /**
   * Se `true`, `skipped` resolve a etapa sem afirmar que ela foi concluída;
   * o lojista pode revisitá-la pela navegação do wizard.
   */
  skippable: boolean;
  kind: OnboardingStepKind;
}

const ECOMMERCE_STEPS: readonly OnboardingStepDefinition[] = [
  {
    // D15.1.1 — nova primeira etapa do wizard: separa "que tipo de
    // negócio é este" (grava `tenants.business_type`, decide qual
    // ONBOARDING_STEPS usar) de "conte sobre sua marca" (que passa a
    // assumir `business_type` já definido). Não pode ser pulada porque é
    // o dado que seleciona a própria definição do wizard.
    key: "segmento",
    title: "Loja online",
    description: "Confirme a criação do seu e-commerce na VEXO.",
    required: true,
    skippable: false,
    kind: "data",
  },
  {
    key: "seu-negocio",
    title: "Seu negócio",
    description: "Conte um pouco sobre a sua marca.",
    required: true,
    skippable: true,
    kind: "data",
  },
  {
    key: "revisar",
    title: "Revisar loja",
    description: "Veja como sua loja vai ficar antes de publicar.",
    required: true,
    skippable: true,
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
 * Só `ecommerce` tem entrada. `Partial<Record<...>>`
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
