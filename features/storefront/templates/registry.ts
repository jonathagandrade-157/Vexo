import type { FunctionComponent } from "react";

import { CommerceHome } from "@/components/storefront/templates/commerce/home";
import { EditorialHome } from "@/components/storefront/templates/editorial/home";
import { FashionHome } from "@/components/storefront/templates/fashion/home";
import { MinimalHome } from "@/components/storefront/templates/minimal/home";
import { PremiumHome } from "@/components/storefront/templates/premium/home";
import { STOREFRONT_TEMPLATES, type StorefrontTemplate } from "@/features/settings/appearance-schema";
import type { StorefrontHomeProps } from "./types";

/**
 * Sprint 1 — Fase B2 §3. Único ponto que sabe qual componente de Home
 * corresponde a cada `storefront_template` — uma tabela de lookup pura,
 * nunca lógica. Trocar/adicionar um template altera só esta linha; nunca
 * precisa tocar `app/loja/[slug]/page.tsx`.
 */
const STOREFRONT_HOME_COMPONENTS: Record<StorefrontTemplate, FunctionComponent<StorefrontHomeProps>> = {
  commerce: CommerceHome,
  premium: PremiumHome,
  minimal: MinimalHome,
  editorial: EditorialHome,
  fashion: FashionHome,
};

/**
 * Fallback seguro para Commerce (Sprint 1 Fase B2 §12) — nunca deveria
 * disparar na prática (a coluna tem CHECK constraint fechado + default),
 * mas protege contra qualquer valor inesperado chegando até aqui sem
 * exigir que o chamador valide antes.
 */
export function getStorefrontHomeComponent(template: string | null | undefined): FunctionComponent<StorefrontHomeProps> {
  if (template && (STOREFRONT_TEMPLATES as readonly string[]).includes(template)) {
    return STOREFRONT_HOME_COMPONENTS[template as StorefrontTemplate];
  }
  return STOREFRONT_HOME_COMPONENTS.commerce;
}
