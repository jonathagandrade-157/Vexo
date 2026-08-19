import type { Metadata } from "next";

import { ComingSoon } from "@/components/painel/coming-soon";

export const metadata: Metadata = { title: "Configurações — VEXO Master" };

export default function MasterConfiguracoesPage() {
  return (
    <ComingSoon
      description="Configurações globais da plataforma chegam em uma etapa futura do produto."
      icon="settings"
      title="Configurações"
    />
  );
}
