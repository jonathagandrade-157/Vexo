import type { Metadata } from "next";

import { ComingSoon } from "@/components/painel/coming-soon";

export const metadata: Metadata = { title: "Assinatura — VEXO" };

export default function AssinaturaPage() {
  return (
    <ComingSoon
      description="Planos pagos e cobrança chegam em uma etapa futura do produto. Seu período de teste continua ativo."
      icon="workspace_premium"
      title="Assinatura"
    />
  );
}
