/**
 * Correção de build (Vercel) — um arquivo `"use server"` só pode exportar
 * funções async; `TenantPlanActionState`/`initialTenantPlanState` viviam
 * em `tenants-actions.ts` junto com as Server Actions, e
 * `initialTenantPlanState` (um objeto em runtime) quebrava a coleta de
 * configuração de qualquer rota que importasse qualquer coisa daquele
 * arquivo (ex.: `/master/lojas/[id]`). Mesmo padrão já usado em
 * `features/commercial/schema.ts`: tipos e estado inicial ficam num
 * arquivo separado, sem `"use server"`.
 */
export interface TenantPlanActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

export const initialTenantPlanState: TenantPlanActionState = { status: "idle" };
