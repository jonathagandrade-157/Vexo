import { z } from "zod";

const emptyToUndefined = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);

/**
 * Preço fica opcional de propósito (prompt Etapa 14 §4: "não definir
 * preços reais") — o MASTER pode deixar em branco por enquanto e
 * preencher depois, sem bloquear a criação do plano.
 */
export const planSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "Slug muito curto")
    .max(60)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use letras minúsculas, números e hífen"),
  name: z.string().trim().min(1, "Informe o nome do plano").max(80),
  description: z.preprocess(emptyToUndefined, z.string().trim().max(500, "Máximo de 500 caracteres").optional()),
  monthlyPrice: z.preprocess(emptyToUndefined, z.coerce.number().min(0, "Preço inválido").max(999999.99).optional()),
  yearlyPrice: z.preprocess(emptyToUndefined, z.coerce.number().min(0, "Preço inválido").max(999999.99).optional()),
  trialDays: z.coerce.number().int().min(0, "Prazo inválido").max(365),
  sortOrder: z.coerce.number().int().min(0).max(9999),
  isFeatured: z.boolean(),
});

export type PlanInput = z.infer<typeof planSchema>;

export interface PlanActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<keyof PlanInput, string>>;
}

export const initialPlanState: PlanActionState = { status: "idle" };

export const featureSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "Chave muito curta")
    .max(60)
    .regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, "Use letras minúsculas, números e underscore (snake_case)"),
  name: z.string().trim().min(1, "Informe o nome do recurso").max(80),
  description: z.preprocess(emptyToUndefined, z.string().trim().max(500, "Máximo de 500 caracteres").optional()),
  category: z.preprocess(emptyToUndefined, z.string().trim().max(60).optional()),
});

export type FeatureInput = z.infer<typeof featureSchema>;

export interface FeatureActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<keyof FeatureInput, string>>;
}

export const initialFeatureState: FeatureActionState = { status: "idle" };

/**
 * Limite ≠ recurso (ajuste arquitetural do prompt: "feature e limite são
 * conceitos diferentes") — `limitValue = -1` é o sentinel de "ilimitado"
 * (`plan_limits.limit_value >= -1`, migration 20260817220058), nunca
 * `null`: um limite sempre tem um número quando a linha existe.
 */
export const planLimitSchema = z.object({
  limitKey: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "Chave muito curta")
    .max(60)
    .regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, "Use letras minúsculas, números e underscore (snake_case)"),
  limitValue: z.coerce.number().int().min(-1, "Use -1 para ilimitado").max(2147483647),
});

export type PlanLimitInput = z.infer<typeof planLimitSchema>;

export interface PlanLimitActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<keyof PlanLimitInput, string>>;
}

export const initialPlanLimitState: PlanLimitActionState = { status: "idle" };
