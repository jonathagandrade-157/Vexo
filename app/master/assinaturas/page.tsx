import type { Metadata } from "next";

import { ComingSoon } from "@/components/painel/coming-soon";

export const metadata: Metadata = { title: "Assinaturas — VEXO Master" };

export default function MasterAssinaturasPage() {
  return (
    <ComingSoon
      description="A gestão de assinaturas e cobrança recorrente chega em uma etapa futura do produto."
      icon="receipt_long"
      title="Assinaturas"
    />
  );
}
