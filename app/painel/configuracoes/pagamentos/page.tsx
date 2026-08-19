import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PaymentConnectionCard } from "@/components/painel/payment-connection-card";
import { getCurrentMembership } from "@/features/painel/current-tenant";
import { maskAccountId } from "@/features/payments/mask";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Pagamentos — VEXO" };

const ERROR_MESSAGES: Record<string, string> = {
  oauth_denied: "A conexão com o Mercado Pago foi cancelada.",
  invalid_state: "Não foi possível validar a solicitação de conexão. Tente novamente.",
  session_mismatch: "Sua sessão mudou durante a conexão. Tente novamente.",
  exchange_failed: "Não foi possível concluir a conexão com o Mercado Pago. Tente novamente.",
  vault_failed: "Não foi possível salvar as credenciais com segurança. Tente novamente.",
  connection_failed: "Não foi possível concluir a conexão. Tente novamente.",
};

interface PageProps {
  searchParams: Promise<{ connected?: string; error?: string }>;
}

/** `/painel/configuracoes/pagamentos` — sub-rota nova (Etapa 11), reaproveitando o shell do painel; nunca mostra access_token/refresh_token/client_secret (prompt §16). */
export default async function PagamentosPage({ searchParams }: PageProps) {
  const { connected, error } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const membership = await getCurrentMembership();
  if (!membership) redirect("/sem-loja");
  const { tenant } = membership;

  const [{ data: canView }, { data: canManage }] = await Promise.all([
    supabase.rpc("has_permission", { p_tenant_id: tenant.id, p_permission_key: "payments.view" }),
    supabase.rpc("has_permission", { p_tenant_id: tenant.id, p_permission_key: "payments.manage" }),
  ]);

  if (!canView) {
    return (
      <div className="mx-auto flex max-w-[1024px] flex-col gap-8">
        <h1 className="font-headline text-headline-md text-on-surface">Pagamentos</h1>
        <p className="font-body text-body-sm text-on-surface-variant">Sua função não tem acesso a esta página.</p>
      </div>
    );
  }

  const { data: providerRow } = await supabase
    .from("store_payment_providers")
    .select("status, connected_account_id, connected_at")
    .eq("tenant_id", tenant.id)
    .eq("provider", "mercadopago")
    .maybeSingle();

  return (
    <div className="mx-auto flex max-w-[1024px] flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link className="w-fit font-label text-label-sm text-on-surface-variant hover:text-primary" href="/painel/configuracoes">
          ← Configurações
        </Link>
        <h1 className="font-headline text-headline-md text-on-surface">Pagamentos</h1>
        <p className="font-body text-body-sm text-on-surface-variant">
          Conecte um meio de pagamento para receber pelos pedidos da sua loja.
        </p>
      </div>

      {connected ? (
        <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 font-body text-body-sm text-emerald-400">
          Mercado Pago conectado com sucesso.
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-error/30 bg-error-container/10 px-4 py-3 font-body text-body-sm text-error">
          {ERROR_MESSAGES[error] ?? "Não foi possível concluir a operação. Tente novamente."}
        </p>
      ) : null}

      <PaymentConnectionCard
        canManage={Boolean(canManage)}
        connected={providerRow?.status === "connected"}
        connectedAt={providerRow?.connected_at ?? null}
        maskedAccountId={maskAccountId(providerRow?.connected_account_id ?? null)}
      />
    </div>
  );
}
