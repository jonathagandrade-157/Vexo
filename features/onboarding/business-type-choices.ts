import type { BusinessType } from "./step-definitions";

/**
 * D15.1.1 — única lista de "o que a etapa /onboarding/segmento oferece",
 * reaproveitada tanto pela UI (`app/onboarding/business-type-form.tsx`,
 * que decide o que é clicável) quanto pelo servidor
 * (`saveBusinessTypeAction`, `features/onboarding/actions.ts`, via
 * `isSelectableBusinessType` abaixo) — nunca duas fontes de verdade
 * separadas para "o que pode ser escolhido hoje". VEXO é exclusivamente
 * e-commerce: os valores legados continuam reconhecidos pelo banco, mas
 * não são opções deste produto e não aparecem nesta interface.
 */
export interface BusinessTypeChoice {
  value: BusinessType;
  label: string;
  icon: string;
  enabled: boolean;
}

export const BUSINESS_TYPE_CHOICES: readonly BusinessTypeChoice[] = [
  { value: "ecommerce", label: "Loja/E-commerce", icon: "🛍️", enabled: true },
];

/**
 * Autoridade real de "este valor pode ser salvo hoje" — usada pela Server
 * Action, nunca confiando no que a UI marcou como clicável (um POST
 * forjado com `businessType: "restaurant"` passa no `z.enum` do schema,
 * que aceita os 3 valores da coluna, mas é rejeitado aqui).
 */
export function isSelectableBusinessType(value: BusinessType): boolean {
  return BUSINESS_TYPE_CHOICES.some((choice) => choice.value === value && choice.enabled);
}
