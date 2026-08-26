import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentMembership } from "@/features/painel/current-tenant";
import { PreviewTarget } from "./preview-target";

export const metadata: Metadata = { title: "Prévia — VEXO" };

/**
 * Sprint 1 — Fase B3. Alvo do `<iframe>` do editor de Aparência
 * (`/painel/aparencia`) — fora da subárvore de `app/painel/layout.tsx` de
 * propósito, para não herdar o shell (sidebar/header/bottom nav) dentro do
 * iframe. Mesmo assim, a mesma checagem de sessão de qualquer rota do
 * painel: sem sessão/sem membership, não renderiza nada (defesa em
 * profundidade — o conteúdo em si já é o mesmo dado público da storefront,
 * mas esta rota nunca deveria ser alcançável fora do próprio editor).
 */
export default async function AparenciaPreviewPage() {
  const membership = await getCurrentMembership();
  if (!membership) redirect("/login");

  return <PreviewTarget />;
}
