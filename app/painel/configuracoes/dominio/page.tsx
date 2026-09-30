import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DomainSettingsForm } from "@/components/painel/domain-settings-form";
import { getCurrentMembership } from "@/features/painel/current-tenant";
import { listTenantDomains } from "@/features/settings/domain-actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Domínio — VEXO" };

/**
 * Gerenciamento de domínio próprio: cadastro, verificação por DNS TXT e
 * acompanhamento do binding na Vercel. Mesmo shell de
 * `/pedidos`/`/pagamentos`/`/entrega`.
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
          Cadastre seu domínio, confirme a propriedade por DNS e acompanhe a conexão com a Vercel.
        </p>
      </div>

      <DomainSettingsForm canEdit={Boolean(canEdit)} domains={domains} />
    </div>
  );
}
