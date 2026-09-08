import type { HistoryAction, HistoryEntityType } from "./schema";

/**
 * D18.4 — rótulo amigável de cada evento (mesmo princípio de
 * `ACTION_LABELS` em `components/master/audit-log-row.tsx`, cópia local
 * própria — o catálogo do lojista é um subconjunto diferente, ver
 * `features/history/schema.ts::HISTORY_ACTIONS`). `action` bruto NUNCA é a
 * experiência principal (Fase 2 §8): uma `action` fora deste mapa (evento
 * futuro ainda não traduzido aqui) cai no fallback seguro
 * `"Alteração registrada"`, nunca aparece como texto técnico.
 */
const ACTION_LABELS: Record<HistoryAction, string> = {
  TENANT_CREATED: "Loja criada",
  TENANT_STATUS_CHANGED: "Status da loja alterado",
  TENANT_SUSPENDED: "Loja suspensa",
  TENANT_ONBOARDING_COMPLETED: "Configuração inicial concluída",
  TENANT_SETTINGS_UPDATED: "Configurações da loja atualizadas",
  TENANT_PIX_SETTINGS_UPDATED: "Configurações de PIX atualizadas",
  TENANT_APPEARANCE_UPDATED: "Aparência da loja atualizada",
  TENANT_CHECKOUT_MODE_UPDATED: "Forma de receber pedidos atualizada",
  TENANT_ADDRESS_UPDATED: "Endereço da loja atualizado",
  STOREFRONT_BANNER_CREATED: "Banner criado",
  STOREFRONT_BANNER_UPDATED: "Banner atualizado",
  STOREFRONT_BANNER_DELETED: "Banner excluído",
  USER_ROLE_CHANGED: "Função de um membro alterada",
  TEAM_MEMBER_INVITED: "Membro convidado",
  TEAM_MEMBER_REMOVED: "Membro removido da equipe",
  TEAM_MEMBER_STATUS_CHANGED: "Status de um membro alterado",
  CATEGORY_CREATED: "Categoria criada",
  CATEGORY_UPDATED: "Categoria atualizada",
  CATEGORY_DELETED: "Categoria excluída",
  PRODUCT_CREATED: "Produto criado",
  PRODUCT_UPDATED: "Produto atualizado",
  PRODUCT_DELETED: "Produto excluído",
  PRODUCT_STATUS_CHANGED: "Status do produto alterado",
  PRODUCT_IMAGE_UPLOADED: "Imagem de produto enviada",
  PRODUCT_IMAGE_UPDATED: "Imagem de produto atualizada",
  PRODUCT_IMAGE_DELETED: "Imagem de produto excluída",
  ORDER_CREATED: "Pedido criado",
  ORDER_STATUS_CHANGED: "Status do pedido alterado",
  ORDER_PAYMENT_CONFIRMED: "Pagamento de pedido confirmado",
  SHIPPING_SETTINGS_UPDATED: "Configurações de frete atualizadas",
  SHIPPING_METHOD_CREATED: "Método de frete criado",
  SHIPPING_METHOD_UPDATED: "Método de frete atualizado",
  SHIPPING_METHOD_DELETED: "Método de frete excluído",
  SHIPPING_PROVIDER_CONNECTION_CREATED: "Conexão de frete criada",
  SHIPPING_PROVIDER_CONNECTION_REMOVED: "Conexão de frete removida",
  PAYMENT_CONNECTION_CREATED: "Conexão de pagamento criada",
  PAYMENT_CONNECTION_REMOVED: "Conexão de pagamento removida",
  PAYMENT_CREATED: "Pagamento criado",
  PAYMENT_APPROVED: "Pagamento aprovado",
  PAYMENT_REJECTED: "Pagamento rejeitado",
  PAYMENT_CANCELLED: "Pagamento cancelado",
  PAYMENT_REFUNDED: "Pagamento reembolsado",
  PAYMENT_UPDATED: "Pagamento atualizado",
  TENANT_DOMAIN_CREATED: "Domínio cadastrado",
  TENANT_DOMAIN_UPDATED: "Domínio atualizado",
  TENANT_DOMAIN_DELETED: "Domínio removido",
  TENANT_PLAN_CHANGED: "Plano da loja alterado",
  BILLING_INVOICE_CREATED: "Fatura de assinatura criada",
  BILLING_PAYMENT_CONFIRMED: "Pagamento de assinatura confirmado",
  BILLING_PAYMENT_FAILED: "Pagamento de assinatura falhou",
  BILLING_SUBSCRIPTION_CANCELLED: "Assinatura da VEXO cancelada",
  BILLING_SUBSCRIPTION_SUSPENDED: "Assinatura da VEXO suspensa",
  TRIAL_STARTED: "Teste grátis iniciado",
};

const FALLBACK_ACTION_LABEL = "Alteração registrada";

export function resolveHistoryActionLabel(action: string): string {
  return ACTION_LABELS[action as HistoryAction] ?? FALLBACK_ACTION_LABEL;
}

const ENTITY_TYPE_LABELS: Record<HistoryEntityType, string> = {
  tenant: "Loja",
  tenant_member: "Equipe",
  storefront_banner: "Banner",
  category: "Categoria",
  product: "Produto",
  order: "Pedido",
  shipping_settings: "Frete",
  shipping_method: "Frete",
  shipping_provider: "Frete",
  payment_provider: "Pagamentos",
  payment: "Pagamento",
  tenant_domain: "Domínio",
  subscription: "Plano",
  billing_invoice: "Faturamento",
  trial_records: "Teste grátis",
};

export function resolveHistoryEntityLabel(resourceType: string | null): string {
  if (!resourceType) return "—";
  return ENTITY_TYPE_LABELS[resourceType as HistoryEntityType] ?? resourceType;
}

/**
 * D18.4 §10 — rótulo do "Usuário" da linha. `actor_type='user'` sempre
 * tenta o nome resolvido de `profiles` (feito por `features/history/data.ts`);
 * se a membership não existir mais (`profiles` já foi apagada ou o join não
 * encontrou nada), cai em "Usuário removido" — nunca um UUID bruto.
 * `system`/`master` NUNCA tentam resolver `actor_user_id` (Fase 2 item 10 —
 * a decisão do produto já veio como regra fixa, não uma heurística): os
 * dois têm rótulo fixo, mesmo que por acaso a coluna viesse preenchida.
 */
export function resolveHistoryActorLabel(log: { actorType: string; actorName: string | null }): string {
  if (log.actorType === "system") return "Sistema";
  if (log.actorType === "master") return "Equipe VEXO";
  return log.actorName ?? "Usuário removido";
}

/**
 * D18.4 §9 — descrição de uma linha em UMA frase curta, nunca JSON bruto.
 * `before`/`after` aqui já chegam redigidos (`redactSensitiveJson`,
 * reaproveitado de `features/master/audit-data.ts` dentro de
 * `features/history/data.ts`, antes desta função rodar) — mesmo assim, esta
 * função só olha um conjunto fixo de chaves conhecidas/seguras
 * (`FIELD_LABELS`), nunca serializa o objeto inteiro, então mesmo um campo
 * novo e sensível que um trigger futuro viesse a gravar por engano nunca
 * apareceria aqui (defesa em profundidade além da redação).
 */
const FIELD_LABELS: Record<string, string> = {
  status: "Status",
  price: "Preço",
  promotional_price: "Preço promocional",
  name: "Nome",
  domain: "Domínio",
  main_image: "Imagem",
  pix_enabled: "PIX",
  pix_key: "Chave PIX",
  plan_id: "Plano",
  logo_url: "Logo",
  primary_color: "Cor primária",
  secondary_color: "Cor secundária",
  storefront_template: "Modelo visual",
  checkout_mode: "Forma de receber pedidos",
  address_city: "Endereço",
  title: "Título",
  link_url: "Link",
};

function firstChangedFieldLabel(before: unknown, after: unknown): string | null {
  if (before === null || after === null || typeof before !== "object" || typeof after !== "object") return null;
  const beforeObj = before as Record<string, unknown>;
  const afterObj = after as Record<string, unknown>;
  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    if (key in afterObj && JSON.stringify(beforeObj[key]) !== JSON.stringify(afterObj[key])) {
      return label;
    }
  }
  return null;
}

export function buildHistoryEventDescription(log: { action: string; before: unknown; after: unknown }): string {
  const changedField = firstChangedFieldLabel(log.before, log.after);
  if (changedField) return `${changedField} alterado(a)`;
  return resolveHistoryActionLabel(log.action);
}
