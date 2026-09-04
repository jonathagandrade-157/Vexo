import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DomainSettingsForm } from "@/components/painel/domain-settings-form";
import { getCurrentMembership } from "@/features/painel/current-tenant";
import { listTenantDomains } from "@/features/settings/domain-actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Domínio — VEXO" };

/**
 * D17.2 — primeira camada de gerenciamento de domínio próprio
 * (infraestrutura de banco: D17.1, `tenant_domains`). Só cadastro como
 * `pending` — nenhuma verificação DNS, nenhuma resolução de host por
 * domínio, nenhum domínio realmente ativo nesta etapa (isso é D17.3+, ver
 * relatório D17.0). Mesmo shell de `/pedidos`/`/pagamentos`/`/entrega`
 * (link "← Configurações", header, formulário).
 */
export default async function DominioSettingsPage() {
  const supabase = await createSupabaseServerClient();

  const membership = await getCurrentMembership();
  if (!membership) redirect("/sem-loja");
  const { tenant } = membership;

  const [{ data: canEdit }, domains] = await Promise.all([
    supabase.rpc("has_permission", { p_tenant_id: tenant.id, p_permission_key: "settings.update" }),
    listTenantDomains(tenant.id),
  ]);

  return (
    <div className="mx-auto flex max-w-[1024px] flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link className="w-fit font-label text-label-sm text-on-surface-variant hover:text-primary" href="/painel/configuracoes">
          ← Configurações
        </Link>
        <h1 className="font-headline text-headline-md text-on-surface">Domínio</h1>
        <p className="font-body text-body-sm text-on-surface-variant">
          Cadastre um domínio próprio para sua loja. A verificação e ativação acontecem em uma etapa futura.
        </p>
      </div>

      <DomainSettingsForm canEdit={Boolean(canEdit)} domains={domains} />
    </div>
  );
}
