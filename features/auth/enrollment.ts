import "server-only";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { slugify, slugifyWithSuffix } from "@/lib/utils/slugify";
import { resolvePostLoginDestination } from "./post-login-destination";
import { getCurrentMembership } from "@/features/painel/current-tenant";
import { clearPendingSignup } from "./pending-signup-cookie";
import type { EnrollmentInput } from "./pending-signup";
import type { SignUpActionState } from "./schema";

interface TenantRow { id: string; status: string }

export async function completeEnrollment(input: EnrollmentInput): Promise<SignUpActionState | { status: "complete"; destination: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user || !user.email_confirmed_at || user.id !== input.userId) {
    return { status: "error", message: "Confirme seu e-mail e entre na conta para concluir o cadastro." };
  }
  const destination = await resolvePostLoginDestination();
  let tenant: TenantRow | null = null;
  if (destination !== "/cadastro") {
    if (destination === "/onboarding") {
      const membership = await getCurrentMembership();
      if (membership?.roleKey === "OWNER" && membership.tenant.onboarding_completed_at === null) {
        const { data: subscription, error: subscriptionError } = await supabase.from("subscriptions").select("id").eq("tenant_id", membership.tenant.id).maybeSingle();
        if (subscriptionError) return { status: "error", message: "Não foi possível verificar seu cadastro. Tente novamente." };
        // A previous create_tenant may have committed before the trial RPC
        // failed. Reuse it; eligibility remains enforced by the trial RPC.
        if (!subscription) tenant = { id: membership.tenant.id, status: membership.tenant.status };
      }
    }
    if (!tenant) { await clearPendingSignup(); return { status: "complete", destination }; }
  }
  const { storeName, fullName, phone, documentHash } = input;
  // Enrich the profile the Etapa 2 signup trigger already created (just
  // id + email). cpf_hash is UNIQUE — a collision here means this
  // document already backs another account, which is the same
  // "already used" outcome as a trial_eligibility collision.
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ full_name: fullName, phone, cpf_hash: documentHash })
    .eq("id", user.id);

  if (profileError) {
    if (profileError.code === "23505") {
      await clearPendingSignup();
      return { status: "complete", destination: "/trial/ja-utilizado" };
    }
    return {
      status: "error",
      message: "Não foi possível salvar seus dados. Tente novamente.",
    };
  }

  for (const slugAttempt of tenant ? [] : [slugify(storeName), slugifyWithSuffix(storeName)]) {
    const { data, error } = await supabase.rpc("create_tenant", {
      p_name: storeName,
      p_slug: slugAttempt,
    });

    if (!error) {
      tenant = data as unknown as TenantRow;
      break;
    }
    // 23505 = unique_violation on tenants.slug — try once more with a
    // random suffix before giving up (see slugifyWithSuffix).
    if (error.code !== "23505") {
      return {
        status: "error",
        message: "Não foi possível criar sua loja. Tente novamente.",
      };
    }
  }

  if (!tenant) {
    return {
      status: "error",
      message: "Não foi possível criar sua loja. Tente novamente.",
    };
  }

  // service_role, not the session-bound `supabase` client: this RPC's
  // p_document_hash must never be reachable directly by `authenticated`
  // (see the migration's header comment for why) — only this server-side
  // call receives a hash computed by the signup action from the validated
  // document, or recovered from the authenticated encrypted signup cookie.
  const { error: trialError } = await createSupabaseServiceRoleClient().rpc(
    "start_trial_for_tenant",
    {
      p_user_id: user.id,
      p_tenant_id: tenant.id,
      p_document_hash: documentHash,
    },
  );

  if (trialError) {
    if (trialError.code === "VX001") {
      await clearPendingSignup();
      return { status: "complete", destination: "/trial/ja-utilizado" };
    }
    return {
      status: "error",
      message: "Não foi possível iniciar seu período de teste. Tente novamente.",
    };
  }

  await clearPendingSignup();
  return { status: "complete", destination: `/trial/sucesso?tenant=${tenant.id}` };
}
