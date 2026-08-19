import { UpgradeCta } from "@/components/painel/upgrade-cta";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Infraestrutura de feature gating para o painel do lojista (prompt
 * Etapa 14 §20) — Server Component, chama `tenant_has_feature` (RPC,
 * migration 20260817220055), que é a fonte oficial de autorização. Só
 * mostra/esconde/apresenta upgrade — NUNCA substitui a validação do
 * backend (prompt §13/§20: "o componente não substitui a proteção do
 * backend"). Qualquer Server Action por trás de `children` precisa
 * checar `tenant_has_feature` de novo, do seu próprio lado, exatamente
 * como toda Action deste projeto já revalida permissão mesmo depois de
 * uma checagem na página (defesa em profundidade).
 *
 * Não usado por nenhuma página existente ainda (prompt §20: "não
 * reescrever o painel inteiro... criar a infraestrutura" — nenhum
 * recurso gateável existe de verdade nesta etapa).
 */
export async function FeatureGate({
  tenantId,
  feature,
  featureName,
  children,
}: {
  tenantId: string;
  feature: string;
  featureName?: string;
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const { data: allowed } = await supabase.rpc("tenant_has_feature", { p_tenant_id: tenantId, p_feature_key: feature });

  if (allowed) return <>{children}</>;
  return <UpgradeCta featureName={featureName ?? feature} />;
}
