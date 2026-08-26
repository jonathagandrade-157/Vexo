import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentMembership } from "@/features/painel/current-tenant";
import type { StorefrontTemplate } from "@/features/settings/appearance-schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppearanceForm } from "./appearance-form";

export const metadata: Metadata = {
  title: "Aparência da loja — VEXO",
};

interface AppearanceRow {
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  storefront_template: string;
}

/**
 * Sprint 1 — Fase A. Rota separada de `/painel/configuracoes` (Configurações
 * Gerais), mesmo princípio já usado para Pagamentos/Entrega — um hub com
 * botões para sub-páginas, não tudo empilhado num único formulário. Nome/
 * descrição continuam vivendo só em `tenants` e só editáveis em
 * Configurações Gerais; aqui são lidos, nunca duplicados num formulário
 * próprio (Sprint 1 Fase A, requisito explícito).
 *
 * `canEdit` decidido no servidor via `has_permission` (mesma permissão
 * `settings.update` que já governa o resto do perfil da loja) — RLS
 * continua sendo a autoridade final, este check é só para não renderizar
 * um formulário editável para quem a RLS vai bloquear de qualquer forma.
 */
export default async function AparenciaPage() {
  const supabase = await createSupabaseServerClient();

  const membership = await getCurrentMembership();
  if (!membership) redirect("/sem-loja");
  const { tenant } = membership;

  const [{ data: canEdit }, { data: appearance }] = await Promise.all([
    supabase.rpc("has_permission", { p_tenant_id: tenant.id, p_permission_key: "settings.update" }),
    supabase
      .from("tenants")
      .select("logo_url, primary_color, secondary_color, storefront_template")
      .eq("id", tenant.id)
      .maybeSingle<AppearanceRow>(),
  ]);

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-8">
      <div>
        <h1 className="font-headline text-headline-md text-on-surface">Aparência da loja</h1>
        <p className="mt-2 font-body text-body-sm text-on-surface-variant">
          Personalize como sua loja será apresentada aos clientes.
        </p>
      </div>

      <AppearanceForm
        canEdit={Boolean(canEdit)}
        initialLogoPath={appearance?.logo_url ?? null}
        initialPrimaryColor={appearance?.primary_color ?? null}
        initialSecondaryColor={appearance?.secondary_color ?? null}
        initialTemplate={(appearance?.storefront_template as StorefrontTemplate | undefined) ?? "commerce"}
        storeDescription={tenant.description}
        storeName={tenant.name}
      />
    </div>
  );
}
