"use server";

import { revalidatePath } from "next/cache";

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { getPublicEnv } from "@/lib/env";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { friendlyTeamErrorMessage } from "./messages";
import { changeRoleSchema, inviteTeamMemberSchema, type InviteTeamMemberInput, type TeamActionState } from "./schema";

const EQUIPE_PATH = "/painel/equipe";

export interface TeamMemberRow {
  id: string;
  userId: string;
  fullName: string | null;
  email: string | null;
  roleKey: string;
  status: string;
  isSelf: boolean;
}

/**
 * D18.3 — mesmo checklist de sempre (cópia local, não compartilhada —
 * mesmo padrão documentado em domain-vercel-actions.ts e todo o resto de
 * `features/settings/*`): sessão via `resolveActiveTenantForUser` (nunca
 * `tenant_id` de formulário/cliente), permissão explícita via
 * `has_permission`. `team.manage` — não `settings.update` — porque equipe é
 * um domínio de autorização à parte, mais sensível (mesmo raciocínio já
 * usado para `payments.manage`/`shipping_provider.manage`).
 */
async function resolveTenantWithTeamManage(): Promise<{ tenantId: string; userId: string } | { error: string }> {
  const supabase = await createSupabaseServerClient();
  const membership = await resolveActiveTenantForUser(supabase);
  if (!membership || membership.tenant.onboarding_completed_at === null) {
    return { error: "Nenhuma loja configurada para esta conta." };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Entre novamente." };

  const { data: allowed } = await supabase.rpc("has_permission", {
    p_tenant_id: membership.tenant.id,
    p_permission_key: "team.manage",
  });
  if (!allowed) {
    return { error: "Você não tem permissão para gerenciar a equipe desta loja." };
  }

  return { tenantId: membership.tenant.id, userId: user.id };
}

/**
 * Lista os membros do tenant atual — chamada pela página, que já resolve
 * `canManage` (`team.manage`) separadamente; a visualização em si só exige
 * `team.view` (checado pela própria RLS de `profiles`, 20260817220105 —
 * ver a policy "tenant staff with team.view can select co-members
 * profiles"). Usa o cliente de SESSÃO (nunca service_role): a policy de
 * SELECT de `tenant_members` (`is_tenant_member`, Etapa 2) e a nova de
 * `profiles` (team.view) já cobrem exatamente este caso, então a
 * segunda camada de defesa da RLS continua valendo aqui, diferente do que
 * acontece com `tenant_domains` (D18.2, ainda via service_role).
 *
 * D18.3.1 — duas consultas separadas (nunca um embed
 * `profiles(full_name, email)` do PostgREST) para ler colegas por
 * `public.team_member_profiles` (view nova, migration 20260817220106) em
 * vez da tabela `profiles` diretamente: a view só tem 3 colunas
 * (id/full_name/email, nunca phone/cpf_hash), então esta função nunca
 * consegue buscar mais do que a tela de equipe precisa — mesmo por
 * engano. A RLS que decide QUAIS colegas aparecem continua sendo
 * inteiramente a de `profiles` (`security_invoker=true` na view).
 */
export async function listTeamMembers(tenantId: string, currentUserId: string): Promise<TeamMemberRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data: memberData } = await supabase
    .from("tenant_members")
    .select("id, user_id, status, role:roles(key)")
    .eq("tenant_id", tenantId)
    .neq("status", "removed")
    .order("created_at", { ascending: true });

  const members = (memberData ?? []) as unknown as {
    id: string;
    user_id: string;
    status: string;
    role: { key: string } | { key: string }[] | null;
  }[];

  const userIds = [...new Set(members.map((m) => m.user_id))];
  const { data: profileData } =
    userIds.length > 0
      ? await supabase.from("team_member_profiles").select("id, full_name, email").in("id", userIds)
      : { data: [] as { id: string; full_name: string | null; email: string | null }[] };

  const profilesById = new Map((profileData ?? []).map((p) => [p.id, p]));

  return members.map((row) => {
    const role = Array.isArray(row.role) ? row.role[0] : row.role;
    const profile = profilesById.get(row.user_id);
    return {
      id: row.id,
      userId: row.user_id,
      fullName: profile?.full_name ?? null,
      email: profile?.email ?? null,
      roleKey: role?.key ?? "",
      status: row.status,
      isSelf: row.user_id === currentUserId,
    };
  });
}

/**
 * Convida um novo funcionário por e-mail. Nunca cria um segundo caminho de
 * autenticação: usa `supabase.auth.admin.inviteUserByEmail` (Supabase Auth
 * nativo — decisão de arquitetura registrada no relatório D18.3, "sem
 * tabela de convite própria, sem token customizado"). Se o e-mail já tiver
 * conta VEXO, retorna erro claro em vez de tentar suportar múltiplas
 * memberships (limitação de escopo documentada — `resolveActiveTenantForUser`
 * só resolve a PRIMEIRA membership ativa do usuário, nunca há seletor de
 * loja na UI hoje).
 */
export async function inviteTeamMemberAction(_prevState: TeamActionState, formData: FormData): Promise<TeamActionState> {
  const parsed = inviteTeamMemberSchema.safeParse({
    email: formData.get("email"),
    roleKey: formData.get("roleKey"),
  });
  if (!parsed.success) {
    const fieldErrors: TeamActionState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof InviteTeamMemberInput;
      fieldErrors[key] ??= issue.message;
    }
    return { status: "error", fieldErrors, message: "Verifique os campos destacados." };
  }

  const resolved = await resolveTenantWithTeamManage();
  if ("error" in resolved) return { status: "error", message: resolved.error };
  const { tenantId, userId } = resolved;

  // D18.3.1 (CAMADA 1) — bloqueia OWNER aqui, ANTES de qualquer chamada ao
  // Supabase (inviteUserByEmail incluído) — nunca confia só no filtro do
  // `<select>` do formulário (components/painel/team-invite-form.tsx),
  // que é só cosmético no client. Reaproveita a mesma mensagem amigável já
  // usada para o trigger equivalente de UPDATE (features/team/messages.ts).
  // A CAMADA 2 (banco, migration 20260817220106::prevent_unauthorized_owner_insert)
  // é quem de fato impede isso de forma incondicional, mesmo se esta
  // checagem for removida/contornada por engano no futuro.
  if (parsed.data.roleKey === "OWNER") {
    return { status: "error", message: friendlyTeamErrorMessage("only an existing OWNER") };
  }

  const { email, roleKey } = parsed.data;
  const serviceClient = createSupabaseServiceRoleClient();

  const { data: roleRow } = await serviceClient.from("roles").select("id").eq("key", roleKey).maybeSingle();
  if (!roleRow) {
    return { status: "error", message: "Função inválida." };
  }

  const { NEXT_PUBLIC_SITE_URL } = getPublicEnv();
  const { data: inviteData, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${NEXT_PUBLIC_SITE_URL}/redefinir-senha`,
  });

  if (inviteError || !inviteData.user) {
    const code = (inviteError as { code?: string } | null)?.code ?? "";
    const alreadyExists =
      code === "email_exists" ||
      code === "user_already_exists" ||
      (inviteError?.message ?? "").toLowerCase().includes("already been registered") ||
      (inviteError?.message ?? "").toLowerCase().includes("already registered");
    if (alreadyExists) {
      return {
        status: "error",
        message: "Este e-mail já possui uma conta VEXO e não pode ser adicionado a esta loja nesta versão.",
      };
    }
    return { status: "error", message: "Não foi possível enviar o convite. Tente novamente." };
  }

  const { error: insertError } = await serviceClient.from("tenant_members").insert({
    tenant_id: tenantId,
    user_id: inviteData.user.id,
    role_id: roleRow.id,
    status: "invited",
    invited_by: userId,
  });

  if (insertError) {
    return { status: "error", message: "Convite enviado, mas não foi possível vinculá-lo à sua loja. Tente novamente." };
  }

  revalidatePath(EQUIPE_PATH);
  return { status: "success", message: "Convite enviado com sucesso." };
}

/**
 * Troca a função de um membro. Usa o cliente de SESSÃO (nunca
 * service_role) — a RLS de UPDATE de `tenant_members` (`team.manage` e
 * `user_id <> auth.uid()`, 20260817220013) e os triggers de defesa em
 * profundidade (auto-promoção, concessão de OWNER, último OWNER,
 * 20260817220013/20260817220105) são a autoridade real; esta Action só
 * traduz o erro deles para uma mensagem segura.
 */
export async function changeTeamMemberRoleAction(memberId: string, roleKey: string): Promise<TeamActionState> {
  const parsedRole = changeRoleSchema.safeParse({ roleKey });
  if (!parsedRole.success) {
    return { status: "error", message: "Função inválida." };
  }

  const resolved = await resolveTenantWithTeamManage();
  if ("error" in resolved) return { status: "error", message: resolved.error };
  const { tenantId } = resolved;

  const supabase = await createSupabaseServerClient();

  const { data: roleRow } = await supabase.from("roles").select("id").eq("key", parsedRole.data.roleKey).maybeSingle();
  if (!roleRow) {
    return { status: "error", message: "Função inválida." };
  }

  const { error, count } = await supabase
    .from("tenant_members")
    .update({ role_id: roleRow.id }, { count: "exact" })
    .eq("id", memberId)
    .eq("tenant_id", tenantId);

  if (error) {
    return { status: "error", message: friendlyTeamErrorMessage(error.message) };
  }
  if (!count) {
    return { status: "error", message: "Membro não encontrado." };
  }

  revalidatePath(EQUIPE_PATH);
  return { status: "success", message: "Função atualizada." };
}

/**
 * Remove um membro do tenant atual. Mesmo raciocínio de
 * `changeTeamMemberRoleAction`: cliente de sessão, RLS de DELETE
 * (`team.manage` + `user_id <> auth.uid()` + "remover OWNER exige ser
 * OWNER", 20260817220013) e o trigger de último OWNER (20260817220105) são
 * quem de fato autoriza.
 */
export async function removeTeamMemberAction(memberId: string): Promise<TeamActionState> {
  const resolved = await resolveTenantWithTeamManage();
  if ("error" in resolved) return { status: "error", message: resolved.error };
  const { tenantId } = resolved;

  const supabase = await createSupabaseServerClient();

  const { error, count } = await supabase
    .from("tenant_members")
    .delete({ count: "exact" })
    .eq("id", memberId)
    .eq("tenant_id", tenantId);

  if (error) {
    return { status: "error", message: friendlyTeamErrorMessage(error.message) };
  }
  if (!count) {
    return { status: "error", message: "Membro não encontrado." };
  }

  revalidatePath(EQUIPE_PATH);
  return { status: "success", message: "Membro removido." };
}
