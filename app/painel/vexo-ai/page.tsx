import type { Metadata } from "next";

import { ComingSoon } from "@/components/painel/coming-soon";

export const metadata: Metadata = { title: "Vexo AI — VEXO" };

export default function VexoAiPage() {
  return (
    <ComingSoon
      description="Os recursos de inteligência artificial da Vexo chegam em uma etapa futura do produto."
      icon="auto_awesome"
      title="Vexo AI Spark"
    />
  );
}
