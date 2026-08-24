import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ComingSoon } from "@/components/painel/coming-soon";
import { UpgradeCta } from "@/components/painel/upgrade-cta";
import { getTenantCommercialContext, hasFeature } from "@/features/commercial/tenant-plan";
import { getCurrentMembership } from "@/features/painel/current-tenant";

export const metadata: Metadata = { title: "Clientes — VEXO" };

/**
 * Etapa 16 §3/§4 — "Clientes" segue ComingSoon (a funcionalidade em si não
 * é desta etapa, prompt §3: "não inventar Clientes/Marketing/..."), mas
 * agora reflete o plano: se o plano do tenant nem inclui a feature
 * `customers`, mostra o `UpgradeCta` (upgrade de plano); se inclui, mostra
 * o `ComingSoon` de sempre (recurso liberado pelo plano, só ainda não
 * construído). Nenhuma lógica de clientes é implementada aqui.
 */
export default async function ClientesPage() {
  const membership = await getCurrentMembership();
  if (!membership) redirect("/sem-loja");

  const context = await getTenantCommercialContext(membership.tenant.id);

  if (!hasFeature(context, "customers")) {
    return <UpgradeCta featureName="Gestão de clientes" />;
  }

  return (
    <ComingSoon
      description="A gestão de clientes chega em uma etapa futura do produto."
      icon="group"
      title="Clientes"
    />
  );
}
