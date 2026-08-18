import type { Metadata } from "next";

import { ComingSoon } from "@/components/painel/coming-soon";

export const metadata: Metadata = { title: "Suporte — VEXO" };

export default function SuportePage() {
  return (
    <ComingSoon
      description="Central de ajuda e abertura de chamados chegam em uma etapa futura do produto."
      icon="help"
      title="Suporte"
    />
  );
}
