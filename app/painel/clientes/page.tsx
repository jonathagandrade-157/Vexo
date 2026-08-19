import type { Metadata } from "next";

import { ComingSoon } from "@/components/painel/coming-soon";

export const metadata: Metadata = { title: "Clientes — VEXO" };

export default function ClientesPage() {
  return (
    <ComingSoon
      description="A gestão de clientes chega em uma etapa futura do produto."
      icon="group"
      title="Clientes"
    />
  );
}
