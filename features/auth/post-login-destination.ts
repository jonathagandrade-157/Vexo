import "server-only";

import { getCurrentPlatformAdmin } from "@/features/master/current-admin";
import { getCurrentMembership } from "@/features/painel/current-tenant";

export type PostLoginDestination = "/master" | "/painel" | "/onboarding" | "/cadastro";

/**
 * Etapa 19 — único ponto que decide para onde um usuário autenticado deve
 * ir (após login, ou ao revisitar /login ou /cadastro já logado). Reaproveita
 * exatamente as mesmas fontes que já protegem as rotas — nunca decide
 * autorização por conta própria:
 *   - getCurrentPlatformAdmin() (Etapa 14, features/master/current-admin.ts)
 *     — a mesma checagem que app/master/layout.tsx usa.
 *   - getCurrentMembership() (Etapa 5, features/painel/current-tenant.ts,
 *     que por sua vez usa resolveActiveTenantForUser de
 *     features/onboarding/resolve-tenant.ts) — a mesma checagem que
 *     app/painel/layout.tsx usa.
 *
 * A regra OWNER-only para /onboarding espelha deliberadamente
 * app/painel/layout.tsx:41-42 (só o OWNER consegue completar o
 * onboarding; qualquer outro papel com onboarding pendente vai para
 * /painel, que já sabe renderizar o estado informativo inerte) — nunca
 * duplica a autorização em si, só a mesma decisão de destino.
 *
 * Este dispatcher nunca É a autorização: app/master/layout.tsx e
 * app/painel/layout.tsx continuam sendo a autoridade real de cada rota,
 * mesmo que este destino "feliz" esteja errado por algum motivo.
 */
export async function resolvePostLoginDestination(): Promise<PostLoginDestination> {
  const admin = await getCurrentPlatformAdmin();
  if (admin) return "/master";

  const membership = await getCurrentMembership();
  if (!membership) return "/cadastro";

  const onboardingPending = membership.tenant.onboarding_completed_at === null;
  if (onboardingPending && membership.roleKey === "OWNER") return "/onboarding";

  return "/painel";
}
