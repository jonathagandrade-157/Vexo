import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentMembership } from "@/features/painel/current-tenant";
import { getTenantCommercialContext, hasFeature } from "@/features/commercial/tenant-plan";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { StoreProfileForm } from "./store-profile-form";

export const metadata: Metadata = {
  title: "Configurações — VEXO",
};

/**
 * Recria a seção "Minha Loja" de `vexo_configura_es_gerais_desktop`
 * (Stitch) — só os 6 campos da Etapa 4 (arquitetura §11 Etapa 5). A
 * seção "Minha Conta" (editar nome/e-mail pessoal, trocar senha, 2FA) do
 * mesmo mockup fica de fora desta etapa — não está entre os dados
 * criados na Etapa 4 e não foi pedida explicitamente.
 *
 * `canEdit` é decidido no SERVIDOR via o wrapper `public.has_permission`
 * (RLS continua sendo a autoridade final) — quem não tem `settings.update`
 * vê os campos, mas sem formulário editável, nunca só escondido no client.
 */
export default async function ConfiguracoesPage() {
  const supabase = await createSupabaseServerClient();

  const membership = await getCurrentMembership();
  if (!membership) redirect("/sem-loja");
  const { tenant } = membership;

  const [{ data: canEdit }, commercialContext] = await Promise.all([
    supabase.rpc("has_permission", { p_tenant_id: tenant.id, p_permission_key: "settings.update" }),
    getTenantCommercialContext(tenant.id),
  ]);
  const hasShipping = hasFeature(commercialContext, "shipping");

  return (
    <div className="mx-auto flex max-w-[1024px] flex-col gap-8">
      <div>
        <h1 className="font-headline text-headline-md text-on-surface">Configurações</h1>
        <p className="mt-2 font-body text-body-sm text-on-surface-variant">
          Dados da sua loja, coletados na configuração inicial.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          className="flex w-fit items-center gap-2 rounded-lg border border-outline-variant/50 px-4 py-2.5 font-label text-label-md text-on-surface transition-colors hover:border-primary/50"
          href="/painel/configuracoes/pedidos"
        >
          <span className="material-symbols-outlined text-[20px] text-primary">receipt_long</span>
          Pedidos
        </Link>
        <Link
          className="flex w-fit items-center gap-2 rounded-lg border border-outline-variant/50 px-4 py-2.5 font-label text-label-md text-on-surface transition-colors hover:border-primary/50"
          href="/painel/configuracoes/pagamentos"
        >
          <span className="material-symbols-outlined text-[20px] text-primary">account_balance_wallet</span>
          Pagamentos
        </Link>
        <Link
          className="flex w-fit items-center gap-2 rounded-lg border border-outline-variant/50 px-4 py-2.5 font-label text-label-md text-on-surface transition-colors hover:border-primary/50"
          href="/painel/configuracoes/entrega"
        >
          <span className="material-symbols-outlined text-[20px] text-primary">local_shipping</span>
          Entrega
          {hasShipping ? null : (
            <span className="material-symbols-outlined text-[16px] text-on-surface-variant" title="Disponível em planos superiores">
              lock
            </span>
          )}
        </Link>
      </div>

      <StoreProfileForm
        canEdit={Boolean(canEdit)}
        defaultValues={{
          storeName: tenant.name,
          segment: tenant.segment ?? "",
          description: tenant.description ?? "",
          instagram: tenant.instagram_handle ?? "",
          whatsapp: tenant.whatsapp_phone ?? "",
          email: tenant.contact_email ?? "",
        }}
      />
    </div>
  );
}
