/** Mesmos 5 valores do `<select>` de `onboarding_sobre_sua_marca` (Etapa 4) — fonte única, reaproveitada pelo formulário de onboarding, o de configurações e o dashboard (rótulo de exibição). */
export const SEGMENT_OPTIONS = [
  { value: "apparel", label: "Moda & Vestuário" },
  { value: "electronics", label: "Eletrônicos" },
  { value: "beauty", label: "Beleza & Cosméticos" },
  { value: "home", label: "Casa & Decoração" },
  { value: "other", label: "Outros" },
] as const;

export function segmentLabel(value: string | null): string {
  return SEGMENT_OPTIONS.find((o) => o.value === value)?.label ?? "Não informado";
}
