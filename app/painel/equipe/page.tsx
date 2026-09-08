import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { TeamInviteForm } from "@/components/painel/team-invite-form";
import { TeamMemberRow } from "@/components/painel/team-member-row";
import { getCurrentMembership } from "@/features/painel/current-tenant";
import { listTeamMembers } from "@/features/team/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Equipe — VEXO" };

/**
 * D18.3 — `/painel/equipe`. Visibilidade da página gated por `team.view`
 * (não apenas membership — reaproveita a permissão já existente desde a
 * Etapa 2, nunca uma nova); edição (convidar/trocar função/remover) gated
 * por `team.manage`, checado de novo em cada Server Action
 * (`resolveTenantWithTeamManage`, features/team/actions.ts) — esta página
 * nunca é a autoridade real, só decide o que RENDERIZAR.
 */
export default async function EquipePage() {
  const supabase = await createSupabaseServerClient();

  const membership = await getCurrentMembership();
  if (!membership) redirect("/sem-loja");
  const { tenant, roleKey } = membership;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: canView }, { data: canManage }] = await Promise.all([
    supabase.rpc("has_permission", { p_tenant_id: tenant.id, p_permission_key: "team.view" }),
    supabase.rpc("has_permission", { p_tenant_id: tenant.id, p_permission_key: "team.manage" }),
  ]);

  if (!canView) {
    return (
      <div className="mx-auto flex max-w-[1024px] flex-col gap-8">
        <h1 className="font-headline text-headline-md text-on-surface">Equipe</h1>
        <p className="font-body text-body-sm text-on-surface-variant">Sua função não tem acesso a esta página.</p>
      </div>
    );
  }

  const members = await listTeamMembers(tenant.id, user.id);

  return (
    <div className="mx-auto flex max-w-[1024px] flex-col gap-8">
      <div>
        <h1 className="font-headline text-headline-md text-on-surface">Equipe</h1>
        <p className="mt-2 font-body text-body-sm text-on-surface-variant">
          Gerencie quem tem acesso ao painel da sua loja e qual função cada pessoa tem.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
        <h2 className="font-headline text-headline-sm text-on-surface">Membros</h2>

        {members.length === 0 ? (
          <p className="font-body text-body-sm text-on-surface-variant">Nenhum membro encontrado.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {members.map((member) => (
              <TeamMemberRow canManage={Boolean(canManage)} key={member.id} member={member} viewerIsOwner={roleKey === "OWNER"} />
            ))}
          </ul>
        )}
      </div>

      {canManage ? <TeamInviteForm /> : null}
    </div>
  );
}
