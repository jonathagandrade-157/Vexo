import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CheckoutModeForm } from "@/components/painel/checkout-mode-form";
import { PixSettingsForm } from "@/components/painel/pix-settings-form";
import { getCurrentMembership } from "@/features/painel/current-tenant";
import { isCheckoutMode, type CheckoutMode } from "@/features/settings/checkout-schema";
import type { PixKeyType } from "@/features/settings/pix-schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Pedidos — VEXO" };

/**
 * Fase D1 — `/painel/configuracoes/pedidos`, sub-rota nova, mesmo shell de
 * `/pagamentos`/`/entrega` (link "← Configurações", header, formulário).
 * Reaproveita `settings.update` (Etapa 2) — não cria permissão nova.
 *
 * `checkout_mode` é lido aqui numa query própria — não em
 * `getCurrentMembership()`/`TENANT_COLUMNS` (`features/onboarding/
 * resolve-tenant.ts`) — mesmo padrão já usado para os campos de Aparência
 * (`/painel/aparencia/page.tsx`), que também não entraram no conjunto de
 * colunas compartilhado usado por todo o painel.
 */
export default async function PedidosSettingsPage() {
  const supabase = await createSupabaseServerClient();

  const membership = await getCurrentMembership();
  if (!membership) redirect("/sem-loja");
  const { tenant } = membership;

  const [{ data: canEdit }, { data: tenantRow }] = await Promise.all([
    supabase.rpc("has_permission", { p_tenant_id: tenant.id, p_permission_key: "settings.update" }),
    supabase
      .from("tenants")
      .select("checkout_mode, pix_enabled, pix_key, pix_key_type, pix_recipient_name")
      .eq("id", tenant.id)
      .maybeSingle(),
  ]);

  const currentMode: CheckoutMode = isCheckoutMode(tenantRow?.checkout_mode) ? tenantRow.checkout_mode : "vexo";

  return (
    <div className="mx-auto flex max-w-[1024px] flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link className="w-fit font-label text-label-sm text-on-surface-variant hover:text-primary" href="/painel/configuracoes">
          ← Configurações
        </Link>
        <h1 className="font-headline text-headline-md text-on-surface">Pedidos</h1>
        <p className="font-body text-body-sm text-on-surface-variant">Defina como sua loja recebe os pedidos dos clientes.</p>
      </div>

      <CheckoutModeForm canEdit={Boolean(canEdit)} currentMode={currentMode} />

      <PixSettingsForm
        canEdit={Boolean(canEdit)}
        initialEnabled={tenantRow?.pix_enabled ?? false}
        initialKey={tenantRow?.pix_key ?? ""}
        initialKeyType={(tenantRow?.pix_key_type as PixKeyType | null) ?? null}
        initialRecipientName={tenantRow?.pix_recipient_name ?? ""}
      />
    </div>
  );
}
