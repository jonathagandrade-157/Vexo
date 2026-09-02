import { describe, expect, it } from "vitest";

import { notificationTargetHref } from "@/features/notifications/schema";

/** D14.1 — única fonte de "para onde uma notificação leva" (prompt §12: "não inventar rota"). */
describe("notificationTargetHref", () => {
  it("resource_type='order' → rota real já existente do painel de pedidos", () => {
    expect(notificationTargetHref({ resource_type: "order", resource_id: "abc-123" })).toBe("/painel/pedidos/abc-123");
  });

  it("resource_type desconhecido → null, nunca um link inventado", () => {
    // @ts-expect-error — testando defensivamente um valor fora do union (ex.: dado antigo/futuro que a UI ainda não sabe abrir).
    expect(notificationTargetHref({ resource_type: "unknown", resource_id: "x" })).toBeNull();
  });
});
