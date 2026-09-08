import { z } from "zod";

export const HISTORY_PAGE_SIZE = 20;

/**
 * D18.4 — catálogo PRÓPRIO do histórico do lojista (auditoria D18.4 Fase 1
 * §3/§7 — nenhum evento inventado, todos levantados diretamente dos
 * `perform private.log_audit(...)` reais nas migrations). Deliberadamente
 * NÃO reaproveita `AUDIT_ACTIONS` de `features/master/audit-data.ts`
 * (decisão do produto, Fase 2 item 7): aquela lista mistura eventos de
 * escopo de plataforma (`PLAN_*`/`FEATURE_*`/`PLAN_LIMIT_*`, sempre
 * `tenant_id = null`) que nunca devem aparecer para um lojista — mantê-las
 * fora daqui, e não só filtrá-las depois, evita que apareçam como opção no
 * filtro de evento por engano.
 *
 * D18.5.1 — acrescenta os 6 eventos novos criados nesta fase
 * (TENANT_APPEARANCE_UPDATED/TENANT_CHECKOUT_MODE_UPDATED/
 * TENANT_ADDRESS_UPDATED/STOREFRONT_BANNER_*, migration
 * 20260817220108) — mesmo princípio: só entra aqui quando existe um
 * emissor real (trigger) correspondente.
 */
export const HISTORY_ACTIONS = [
  "TENANT_CREATED",
  "TENANT_STATUS_CHANGED",
  "TENANT_SUSPENDED",
  "TENANT_ONBOARDING_COMPLETED",
  "TENANT_SETTINGS_UPDATED",
  "TENANT_PIX_SETTINGS_UPDATED",
  "TENANT_APPEARANCE_UPDATED",
  "TENANT_CHECKOUT_MODE_UPDATED",
  "TENANT_ADDRESS_UPDATED",
  "STOREFRONT_BANNER_CREATED",
  "STOREFRONT_BANNER_UPDATED",
  "STOREFRONT_BANNER_DELETED",
  "USER_ROLE_CHANGED",
  "TEAM_MEMBER_INVITED",
  "TEAM_MEMBER_REMOVED",
  "TEAM_MEMBER_STATUS_CHANGED",
  "CATEGORY_CREATED",
  "CATEGORY_UPDATED",
  "CATEGORY_DELETED",
  "PRODUCT_CREATED",
  "PRODUCT_UPDATED",
  "PRODUCT_DELETED",
  "PRODUCT_STATUS_CHANGED",
  "PRODUCT_IMAGE_UPLOADED",
  "PRODUCT_IMAGE_UPDATED",
  "PRODUCT_IMAGE_DELETED",
  "ORDER_CREATED",
  "ORDER_STATUS_CHANGED",
  "ORDER_PAYMENT_CONFIRMED",
  "SHIPPING_SETTINGS_UPDATED",
  "SHIPPING_METHOD_CREATED",
  "SHIPPING_METHOD_UPDATED",
  "SHIPPING_METHOD_DELETED",
  "SHIPPING_PROVIDER_CONNECTION_CREATED",
  "SHIPPING_PROVIDER_CONNECTION_REMOVED",
  "PAYMENT_CONNECTION_CREATED",
  "PAYMENT_CONNECTION_REMOVED",
  "PAYMENT_CREATED",
  "PAYMENT_APPROVED",
  "PAYMENT_REJECTED",
  "PAYMENT_CANCELLED",
  "PAYMENT_REFUNDED",
  "PAYMENT_UPDATED",
  "TENANT_DOMAIN_CREATED",
  "TENANT_DOMAIN_UPDATED",
  "TENANT_DOMAIN_DELETED",
  "TENANT_PLAN_CHANGED",
  "BILLING_INVOICE_CREATED",
  "BILLING_PAYMENT_CONFIRMED",
  "BILLING_PAYMENT_FAILED",
  "BILLING_SUBSCRIPTION_CANCELLED",
  "BILLING_SUBSCRIPTION_SUSPENDED",
  "TRIAL_STARTED",
] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

/**
 * `resource_type` real gravado por cada trigger listado acima (nenhum
 * inventado) — usado como valor do filtro "Entidade". `tenant_member` fica
 * de fora de propósito: os 4 eventos de equipe (`USER_ROLE_CHANGED`/
 * `TEAM_MEMBER_*`) já têm `resource_type = 'tenant_member'` gravado pelo
 * trigger (migrations 20260817220010/220105), então ele entra aqui.
 */
export const HISTORY_ENTITY_TYPES = [
  "tenant",
  "tenant_member",
  "storefront_banner",
  "category",
  "product",
  "order",
  "shipping_settings",
  "shipping_method",
  "shipping_provider",
  "payment_provider",
  "payment",
  "tenant_domain",
  "subscription",
  "billing_invoice",
  "trial_records",
] as const;
export type HistoryEntityType = (typeof HISTORY_ENTITY_TYPES)[number];

export const HISTORY_PERIOD_FILTERS = ["today", "7d", "30d"] as const;
export type HistoryPeriodFilter = (typeof HISTORY_PERIOD_FILTERS)[number];

/**
 * Mesmo padrão de `emptyToUndefined` de `features/orders/schema.ts` —
 * `searchParams` de um `<select>`/`<input>` vazio chega como string vazia,
 * nunca `undefined`, então cada filtro precisa tratar `""` como "sem
 * filtro" antes da validação de enum/uuid.
 */
const emptyToUndefined = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);

/**
 * Valida os filtros vindos de `searchParams` (sempre strings/arbitrárias,
 * nunca confiáveis) ANTES de chegar em `features/history/data.ts` — mesmo
 * princípio de validação de input em toda Server Action do projeto. Um
 * valor fora do catálogo (`action`/`resourceType`/`period` desconhecidos)
 * ou um `userId`/`page` malformado é descartado aqui (`undefined`), nunca
 * vira `WHERE` dinâmico nem quebra a consulta.
 */
export const historyFiltersSchema = z.object({
  action: z.preprocess(emptyToUndefined, z.enum(HISTORY_ACTIONS).optional()),
  resourceType: z.preprocess(emptyToUndefined, z.enum(HISTORY_ENTITY_TYPES).optional()),
  period: z.preprocess(emptyToUndefined, z.enum(HISTORY_PERIOD_FILTERS).optional()),
  userId: z.preprocess(emptyToUndefined, z.uuid().optional()),
  page: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
    z.number().int().positive().optional(),
  ),
});

export type HistoryFilters = z.infer<typeof historyFiltersSchema>;
