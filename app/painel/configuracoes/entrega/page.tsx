import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { FeatureGate } from "@/components/painel/feature-gate";
import { OwnDeliverySettingsForm } from "@/components/painel/own-delivery-settings-form";
import { PanelEmptyState } from "@/components/painel/panel-empty-state";
import { PickupSettingsForm } from "@/components/painel/pickup-settings-form";
import { ShippingConnectionCard } from "@/components/painel/shipping-connection-card";
import { ShippingMethodFormDialog } from "@/components/painel/shipping-method-form-dialog";
import { ShippingMethodRow, type ShippingMethodRowData } from "@/components/painel/shipping-method-row";
import { ShippingSettingsForm } from "@/components/painel/shipping-settings-form";
import { getCurrentMembership } from "@/features/painel/current-tenant";
import { maskAccountId } from "@/features/shipping-connections/mask";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Entrega — VEXO" };

const MELHOR_ENVIO_ERROR_MESSAGES: Record<string, string> = {
  oauth_denied: "A conexão com o Melhor Envio foi cancelada.",
  invalid_state: "Não foi possível validar a solicitação de conexão. Tente novamente.",
  session_mismatch: "Sua sessão mudou durante a conexão. Tente novamente.",
  exchange_failed: "Não foi possível concluir a conexão com o Melhor Envio. Tente novamente.",
  vault_failed: "Não foi possível salvar as credenciais com segurança. Tente novamente.",
  connection_failed: "Não foi possível concluir a conexão. Tente novamente.",
};

interface PageProps {
  searchParams: Promise<{ me_connected?: string; me_error?: string }>;
}

/**
 * `/painel/configuracoes/entrega` — sub-rota nova (Etapa 12), mesmo shell
 * de `/painel/configuracoes/pagamentos` (Etapa 11). Reaproveita
 * `settings.update` (Etapa 2) — não cria permissão nova (prompt §15: só
 * criar se realmente necessário).
 *
 * Etapa 16 — primeiro retrofit real de `FeatureGate` (prompt §3): "shipping"
 * já é um recurso diferenciado por plano desde o seed da Etapa 14 (BASIC
 * não inclui, INTERMEDIATE/PRO incluem), e esta é a única página do painel
 * que já tinha funcionalidade real por trás dela — não uma tela ComingSoon.
 * O gate aqui é só a camada de UX; a validação que importa de verdade está
 * em `resolveTenantAndPermission` (features/shipping/actions.ts), chamada
 * de novo em toda Server Action, independente do que esta página mostrar.
 */
export default async function EntregaPage({ searchParams }: PageProps) {
  const { me_connected: meConnected, me_error: meError } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const membership = await getCurrentMembership();
  if (!membership) redirect("/sem-loja");
  const { tenant } = membership;

  const { data: canManage } = await supabase.rpc("has_permission", {
    p_tenant_id: tenant.id,
    p_permission_key: "settings.update",
  });

  // D3.2-B — permissões próprias da conexão com o Melhor Envio, nunca
  // reaproveitando `settings.update` (a conexão é mais sensível: MANAGER
  // só tem `.view`, mesmo critério de `payments.manage`).
  const [{ data: canViewShippingProvider }, { data: canManageShippingProvider }] = await Promise.all([
    supabase.rpc("has_permission", { p_tenant_id: tenant.id, p_permission_key: "shipping_provider.view" }),
    supabase.rpc("has_permission", { p_tenant_id: tenant.id, p_permission_key: "shipping_provider.manage" }),
  ]);

  const { data: shippingProviderRow } = canViewShippingProvider
    ? await supabase
        .from("store_shipping_providers")
        .select("status, connected_account_id, connected_at")
        .eq("tenant_id", tenant.id)
        .eq("provider", "melhor_envio")
        .maybeSingle()
    : { data: null };

  const [{ data: settingsRow }, { data: methodsData }, { data: pickupRow }, { data: ownDeliveryRow }] = await Promise.all([
    supabase.from("shipping_settings").select("enabled, origin_zip").eq("tenant_id", tenant.id).maybeSingle(),
    // D3.1: esta lista continua só `flat_rate` — pickup/own_delivery são
    // configurações únicas por tenant, mostradas em seções próprias
    // abaixo, nunca misturadas nesta lista/CRUD genérico.
    supabase
      .from("shipping_methods")
      .select("id, name, price, estimated_days, status, sort_order")
      .eq("tenant_id", tenant.id)
      .eq("type", "flat_rate")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("shipping_methods")
      .select("name, estimated_days, status")
      .eq("tenant_id", tenant.id)
      .eq("type", "pickup")
      .maybeSingle(),
    supabase
      .from("shipping_methods")
      .select("name, price, estimated_days, status")
      .eq("tenant_id", tenant.id)
      .eq("type", "own_delivery")
      .maybeSingle(),
  ]);

  const methods: ShippingMethodRowData[] = (methodsData ?? []) as ShippingMethodRowData[];

  return (
    <div className="mx-auto flex max-w-[1024px] flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link className="w-fit font-label text-label-sm text-on-surface-variant hover:text-primary" href="/painel/configuracoes">
          ← Configurações
        </Link>
        <h1 className="font-headline text-headline-md text-on-surface">Entrega</h1>
        <p className="font-body text-body-sm text-on-surface-variant">
          Configure as modalidades de entrega que os clientes veem no checkout.
        </p>
      </div>

      {/*
        D3.2-B — conexão OAuth com o Melhor Envio. Fora do `FeatureGate`
        "shipping" de propósito: conectar a conta é uma capacidade base
        (nenhuma cotação de frete acontece nesta etapa), não um recurso
        diferenciado por plano. Visível só para quem tem
        `shipping_provider.view` (nunca reaproveita `settings.update`).
      */}
      {canViewShippingProvider ? (
        <div className="flex flex-col gap-4">
          <h2 className="font-headline text-headline-sm text-on-surface">Integrações de entrega</h2>
          {meConnected ? (
            <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 font-body text-body-sm text-emerald-400">
              Melhor Envio conectado com sucesso.
            </p>
          ) : null}
          {meError ? (
            <p className="rounded-lg border border-error/30 bg-error-container/10 px-4 py-3 font-body text-body-sm text-error">
              {MELHOR_ENVIO_ERROR_MESSAGES[meError] ?? "Não foi possível concluir a operação. Tente novamente."}
            </p>
          ) : null}
          <ShippingConnectionCard
            canManage={Boolean(canManageShippingProvider)}
            connected={shippingProviderRow?.status === "connected"}
            connectedAt={shippingProviderRow?.connected_at ?? null}
            maskedAccountId={maskAccountId(shippingProviderRow?.connected_account_id ?? null)}
          />
        </div>
      ) : null}

      <FeatureGate feature="shipping" featureName="Frete e entrega" tenantId={tenant.id}>
        <ShippingSettingsForm
          canManage={Boolean(canManage)}
          enabled={settingsRow?.enabled ?? false}
          originZip={settingsRow?.origin_zip ?? null}
        />

        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
          <OwnDeliverySettingsForm
            canManage={Boolean(canManage)}
            initialActive={ownDeliveryRow?.status === "active"}
            initialEstimatedDays={ownDeliveryRow?.estimated_days ?? null}
            initialName={ownDeliveryRow?.name ?? "Entrega própria"}
            initialPrice={ownDeliveryRow?.price ?? 0}
          />
          <PickupSettingsForm
            canManage={Boolean(canManage)}
            initialActive={pickupRow?.status === "active"}
            initialEstimatedDays={pickupRow?.estimated_days ?? null}
            initialName={pickupRow?.name ?? "Retirar na loja"}
          />
        </div>

        <div className="mt-8 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-headline text-headline-sm text-on-surface">Outras modalidades (preço fixo)</h2>
            {canManage ? (
              <ShippingMethodFormDialog
                trigger={
                  <span className="flex items-center justify-center gap-2 rounded-lg bg-primary-container px-5 py-2.5 font-label text-label-md text-on-primary-container shadow-[0_0_15px_rgba(124,58,237,0.2)] transition-colors hover:bg-[#8B5CF6]">
                    <span className="material-symbols-outlined text-[20px]">add</span>
                    Nova modalidade
                  </span>
                }
              />
            ) : null}
          </div>

          {methods.length === 0 ? (
            <PanelEmptyState
              action={
                canManage ? (
                  <ShippingMethodFormDialog
                    trigger={
                      <span className="rounded-lg border border-dashed border-primary/30 px-4 py-2 font-label text-label-md text-primary transition-colors hover:bg-primary/10">
                        Criar primeira modalidade
                      </span>
                    }
                  />
                ) : undefined
              }
              description="Crie ao menos uma modalidade de entrega ativa para que os clientes possam finalizar a compra com frete."
              icon="local_shipping"
              title="Nenhuma modalidade cadastrada"
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-surface-container-highest bg-[#121212]">
              <div className="grid grid-cols-12 gap-4 border-b border-surface-container-highest bg-surface-container-low/50 px-6 py-4">
                <div className="col-span-4 font-label text-label-sm uppercase tracking-wider text-on-surface-variant md:col-span-5">
                  Modalidade
                </div>
                <div className="col-span-2 text-center font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
                  Preço
                </div>
                <div className="col-span-2 text-center font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
                  Prazo
                </div>
                <div className="col-span-2 text-center font-label text-label-sm uppercase tracking-wider text-on-surface-variant md:col-span-1">
                  Status
                </div>
                {canManage ? (
                  <div className="col-span-2 text-right font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
                    Ações
                  </div>
                ) : null}
              </div>
              <div className="divide-y divide-surface-container-highest/50">
                {methods.map((method) => (
                  <ShippingMethodRow canManage={Boolean(canManage)} key={method.id} method={method} />
                ))}
              </div>
            </div>
          )}
        </div>
      </FeatureGate>
    </div>
  );
}
