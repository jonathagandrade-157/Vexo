import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { MasterHeader } from "@/components/master/header";
import { MasterSidebar } from "@/components/master/sidebar";
import { getCurrentPlatformAdmin } from "@/features/master/current-admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ROLE_LABELS: Record<string, string> = { MASTER: "Administrador MASTER", SUPPORT_AGENT: "Suporte VEXO" };

/**
 * Gate server-side único para TODAS as rotas `/master/*` (prompt §15) —
 * mesmo princípio do gate de `/painel` (Etapa 5), reaproveitando
 * `platform_admins`/`is_platform_admin()` (Etapa 2) via
 * `getCurrentPlatformAdmin()`. NUNCA confia em `role === "master"` vindo
 * do client (prompt §15) — a única fonte é a sessão + a tabela
 * `platform_admins`, a mesma que a RLS de escrita de
 * `plans`/`features`/`plan_features`/`subscriptions` usa.
 *
 * Sem sessão → /login (mesmo destino do painel do lojista). Com sessão
 * mas sem platform_admins → /painel (não é um erro, é só a pessoa errada
 * para esta área — devolve para onde ela de fato tem acesso).
 */
export default async function MasterLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = await getCurrentPlatformAdmin();
  if (!admin) redirect("/painel");

  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
  const userName = (profile?.full_name as string | undefined) ?? user.email ?? "Admin";
  const userInitial = userName.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="min-h-dvh bg-background">
      <MasterSidebar adminRole={ROLE_LABELS[admin.role] ?? admin.role} />
      <MasterHeader userInitial={userInitial} userName={userName} />
      <main className="px-margin-mobile pb-24 pt-24 md:ml-[260px] md:px-margin-desktop md:pb-12">
        <div className="mx-auto max-w-[1440px]">{children}</div>
      </main>
    </div>
  );
}
