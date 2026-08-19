import type { Metadata } from "next";

import { ComingSoon } from "@/components/painel/coming-soon";

export const metadata: Metadata = { title: "Clientes — VEXO Master" };

export default function MasterClientesPage() {
  return (
    <ComingSoon
      description="A gestão de contas de clientes da VEXO chega em uma etapa futura do produto."
      icon="group"
      title="Clientes"
    />
  );
}
