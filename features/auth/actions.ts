"use server";

import { redirect } from "next/navigation";

import { getPublicEnv, getServerEnv } from "@/lib/env";
import { hashDocument } from "@/lib/security/hash-identifier";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolvePostLoginDestination } from "./post-login-destination";
import { completeEnrollment } from "./enrollment";
import type { EnrollmentInput } from "./pending-signup";
import { pendingSignupForUser, rememberPendingSignup } from "./pending-signup-cookie";
import { AUTH_RATE_LIMIT_MESSAGE, isAuthAttemptLimited } from "./rate-limit";
import {
  completeSignupSchema,
  resetPasswordRequestSchema,
  signInSchema,
  signUpSchema,
  updatePasswordSchema,
  type ResetPasswordRequestState,
  type SignInActionState,
  type SignInInput,
  type SignUpActionState,
  type SignUpInput,
  type UpdatePasswordActionState,
  type UpdatePasswordInput,
} from "./schema";


/**
 * Full signup flow (architecture §13, §24 Etapa 3):
 *
 *   1. validate input (Zod, allowlist — architecture §10/§18)
 *   2. create the Supabase Auth account
 *   3. enrich the profile (full name, phone, cpf_hash — never plaintext)
 *   4. create the tenant (public.create_tenant, Etapa 2, untouched)
 *   5. claim the trial (public.start_trial_for_tenant, Etapa 3) — this is
 *      where eligibility is actually enforced, in the database, not here
 *
 * Eligibility is checked server-side inside start_trial_for_tenant AFTER
 * signup (not before) so this route never needs an `anon`-callable
 * "is this document eligible" RPC, which would itself be a probing
 * surface (architecture §25.1 reasoning applied to a new case — see
 * docs/architecture/etapa-3-auth-trial.md).
 */
async function submitEnrollment(input: EnrollmentInput): Promise<SignUpActionState> {
  const result = await completeEnrollment(input);
  if (result.status === "complete") redirect(result.destination);
  return result;
}

export async function signUpAction(
  _prevState: SignUpActionState,
  formData: FormData,
): Promise<SignUpActionState> {
  const parsed = signUpSchema.safeParse({
    storeName: formData.get("storeName"),
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    document: formData.get("document"),
    password: formData.get("password"),
    acceptTerms: formData.get("acceptTerms"),
  });

  if (!parsed.success) {
    const fieldErrors: SignUpActionState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof SignUpInput;
      fieldErrors[key] ??= issue.message;
    }
    return {
      status: "error",
      fieldErrors,
      message: "Verifique os campos destacados.",
    };
  }

  const { storeName, fullName, email, phone, document, password } = parsed.data;
  if (await isAuthAttemptLimited("sign_up", email)) return { status: "error", message: AUTH_RATE_LIMIT_MESSAGE };
  const documentHash = hashDocument(document, getServerEnv().TRIAL_HASH_SECRET);

  const supabase = await createSupabaseServerClient();

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${getPublicEnv().NEXT_PUBLIC_SITE_URL}/auth/confirm?purpose=signup` },
  });

  if (signUpError || !signUpData.user) {
    if (signUpError?.code === "user_already_exists") {
      return {
        status: "error",
        message: "Este e-mail já está cadastrado. Tente entrar na sua conta.",
      };
    }
    return {
      status: "error",
      message: "Não foi possível criar sua conta. Tente novamente em instantes.",
    };
  }

  const enrollment = { userId: signUpData.user.id, storeName, fullName, phone, documentHash };
  if (!signUpData.session) {
    await rememberPendingSignup(enrollment);
    redirect("/confirmar-email");
  }
  return submitEnrollment(enrollment);
}

export async function completeSignupAction(_prevState: SignUpActionState, formData: FormData): Promise<SignUpActionState> {
  const parsed = completeSignupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: SignUpActionState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path[0] as keyof SignUpInput] ??= issue.message;
    return { status: "error", fieldErrors, message: "Verifique os campos destacados." };
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email_confirmed_at) return { status: "error", message: "Entre na conta com o e-mail confirmado para continuar." };
  return submitEnrollment({ storeName: parsed.data.storeName, fullName: parsed.data.fullName, phone: parsed.data.phone, userId: user.id,
    documentHash: hashDocument(parsed.data.document, getServerEnv().TRIAL_HASH_SECRET) });
}

export async function finishPendingSignupAction(_prevState: SignUpActionState, _formData: FormData): Promise<SignUpActionState> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const input = user?.email_confirmed_at ? await pendingSignupForUser(user.id) : null;
  if (!input) return { status: "error", message: "Entre na conta e preencha novamente os dados da loja para concluir o cadastro." };
  return submitEnrollment(input);
}

export async function resendConfirmationAction(_prevState: ResetPasswordRequestState, formData: FormData): Promise<ResetPasswordRequestState> {
  const parsed = resetPasswordRequestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { status: "error", message: "Informe um e-mail válido." };
  if (await isAuthAttemptLimited("resend_confirmation", parsed.data.email)) return { status: "error", message: AUTH_RATE_LIMIT_MESSAGE };
  const supabase = await createSupabaseServerClient();
  await supabase.auth.resend({ type: "signup", email: parsed.data.email,
    options: { emailRedirectTo: `${getPublicEnv().NEXT_PUBLIC_SITE_URL}/auth/confirm?purpose=signup` } });
  return { status: "success", message: "Se houver uma confirmação pendente para este e-mail, você receberá um novo link." };
}

export async function signInAction(
  _prevState: SignInActionState,
  formData: FormData,
): Promise<SignInActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const fieldErrors: SignInActionState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof SignInInput;
      fieldErrors[key] ??= issue.message;
    }
    return { status: "error", fieldErrors };
  }

  if (await isAuthAttemptLimited("sign_in", parsed.data.email)) return { status: "error", message: AUTH_RATE_LIMIT_MESSAGE };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Deliberately generic — never confirm/deny whether the email exists.
    return { status: "error", message: "E-mail ou senha inválidos." };
  }

  // Etapa 19 — destino automático pós-login (MASTER/SUPPORT_AGENT →
  // /master, sem tenant → /cadastro, onboarding pendente do OWNER →
  // /onboarding, senão /painel), em vez de sempre "/". Ver
  // resolvePostLoginDestination para a decisão completa.
  const { data: { user } } = await supabase.auth.getUser();
  const pending = user?.email_confirmed_at ? await pendingSignupForUser(user.id) : null;
  if (pending) {
    await submitEnrollment(pending);
    redirect("/cadastro?notice=enrollment_retry");
  }
  redirect(await resolvePostLoginDestination());
}

/** Requests a recovery email without disclosing account existence.
 * The callback exchanges PKCE/OTP before opening the password form. */
export async function resetPasswordRequestAction(
  _prevState: ResetPasswordRequestState,
  formData: FormData,
): Promise<ResetPasswordRequestState> {
  const parsed = resetPasswordRequestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { status: "error", message: "Informe um e-mail válido." };
  }

  if (await isAuthAttemptLimited("password_reset", parsed.data.email)) return { status: "error", message: AUTH_RATE_LIMIT_MESSAGE };

  const supabase = await createSupabaseServerClient();
  const { NEXT_PUBLIC_SITE_URL } = getPublicEnv();
  // Exchange the email code server-side before rendering the form.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${NEXT_PUBLIC_SITE_URL}/auth/confirm?purpose=recovery`,
  });

  return {
    status: "success",
    message: "Se este e-mail estiver cadastrado, você receberá um link para redefinir sua senha.",
  };
}

/** Changes only the verified session user's password, then signs out.
 * New links arrive through /auth/confirm; legacy implicit invite links
 * remain supported by the browser initializer on /redefinir-senha. */
export async function updatePasswordAction(
  _prevState: UpdatePasswordActionState,
  formData: FormData,
): Promise<UpdatePasswordActionState> {
  const parsed = updatePasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    const fieldErrors: UpdatePasswordActionState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof UpdatePasswordInput;
      fieldErrors[key] ??= issue.message;
    }
    return { status: "error", fieldErrors, message: "Verifique os campos destacados." };
  }

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      status: "error",
      message: "Este link de redefinição expirou ou já foi utilizado. Solicite um novo link.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    // Nunca repassa error.message bruto do Supabase (arquitetura: nenhum
    // detalhe interno ao usuário) — mesma postura defensiva de signInAction.
    return {
      status: "error",
      message: "Não foi possível atualizar sua senha. Tente novamente.",
    };
  }

  // D18.3 — mesma página/Action também é o destino do link de CONVITE de
  // equipe (`inviteTeamMemberAction`, `supabase.auth.admin.inviteUserByEmail`
  // com `redirectTo` apontando para cá): o link de convite do Supabase Auth
  // estabelece sessão por fragmento de URL exatamente como o de recovery
  // (por isso `UpdatePasswordForm` já escuta tanto `PASSWORD_RECOVERY`
  // quanto `SIGNED_IN`), então este é o único ponto que precisa saber a
  // diferença. `accept_tenant_invite()` (RPC, 20260817220105) só transiciona
  // linha(s) `tenant_members` já 'invited' do PRÓPRIO usuário (auth.uid()
  // interno) para 'active' — no-op silencioso e seguro para o fluxo comum
  // de "esqueci minha senha", que nunca tem nenhuma linha 'invited'.
  await supabase.rpc("accept_tenant_invite");

  await supabase.auth.signOut();

  return {
    status: "success",
    message: "Senha atualizada com sucesso. Entre novamente com sua nova senha.",
  };
}
