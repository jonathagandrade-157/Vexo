import type { Metadata } from "next";

import { ComingSoon } from "@/components/painel/coming-soon";

export const metadata: Metadata = { title: "Marketing — VEXO" };

export default function MarketingPage() {
  return (
    <ComingSoon
      description="Campanhas, cupons e automações de marketing chegam em uma etapa futura do produto."
      icon="campaign"
      title="Marketing"
    />
  );
}
