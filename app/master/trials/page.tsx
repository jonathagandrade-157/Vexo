import type { Metadata } from "next";

import { ComingSoon } from "@/components/painel/coming-soon";

export const metadata: Metadata = { title: "Trials — VEXO Master" };

export default function MasterTrialsPage() {
  return (
    <ComingSoon
      description="A visualização de trials ativos/expirados chega em uma etapa futura do produto."
      icon="hourglass_top"
      title="Trials"
    />
  );
}
