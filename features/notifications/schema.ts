/**
 * D14.1 — tipos/rótulos da notificação interna do painel. Espelha
 * exatamente o vocabulário da migration 20260817220097 (`type` só tem
 * `new_order` hoje, `resource_type` só tem `order` hoje) — crescer isso
 * exige migration nova, nunca um valor novo aceito silenciosamente aqui.
 */

export const NOTIFICATION_TYPES = ["new_order"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_RESOURCE_TYPES = ["order"] as const;
export type NotificationResourceType = (typeof NOTIFICATION_RESOURCE_TYPES)[number];

export interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  resource_type: NotificationResourceType;
  resource_id: string;
  read_at: string | null;
  created_at: string;
}

/**
 * Função pura — única fonte de "para onde clicar numa notificação leva"
 * (prompt §12: "não inventar rota"). Hoje só existe `order` -> a mesma
 * rota que o painel já usa (`app/painel/pedidos/[id]/page.tsx`); `null`
 * para qualquer `resource_type` que a UI não sabe abrir (nunca um link
 * quebrado inventado).
 */
export function notificationTargetHref(notification: Pick<NotificationRow, "resource_type" | "resource_id">): string | null {
  if (notification.resource_type === "order") {
    return `/painel/pedidos/${notification.resource_id}`;
  }
  return null;
}
