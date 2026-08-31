"use server";

import { redirect } from "next/navigation";

import { getPublicEnv, getServerEnv } from "@/lib/env";
import { hashDocument } from "@/lib/security/hash-identifier";
import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";
import { slugify, slugifyWithSuffix } from "@/lib/utils/slugify";
import { resolvePostLoginDestination } from "./post-login-destination";
import {
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

interface TenantRow {
  id: string;
  status: string;
}

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
  const documentHash = hashDocument(document, getServerEnv().TRIAL_HASH_SECRET);

  const supabase = await createSupabaseServerClient();

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
  });

  // TEMP DIAGNOSTIC LOG — remove after investigation. No PII.
  console.log("SIGNUP_SUCCESS", {
    userIdPresent: Boolean(signUpData?.user?.id),
    sessionPresent: Boolean(signUpData?.session),
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

  // Enrich the profile the Etapa 2 signup trigger already created (just
  // id + email). cpf_hash is UNIQUE — a collision here means this
  // document already backs another account, which is the same
  // "already used" outcome as a trial_eligibility collision.
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ full_name: fullName, phone, cpf_hash: documentHash })
    .eq("id", signUpData.user.id);

  // TEMP DIAGNOSTIC LOG — remove after investigation. No PII.
  if (profileError) {
    console.log("PROFILE_UPDATE_ERROR", {
      code: profileError.code,
      message: profileError.message,
    });
  } else {
    console.log("PROFILE_UPDATE_SUCCESS");
  }

  if (profileError) {
    if (profileError.code === "23505") {
      redirect("/trial/ja-utilizado");
    }
    return {
      status: "error",
      message: "Não foi possível salvar seus dados. Tente novamente.",
    };
  }

  let tenant: TenantRow | null = null;
  for (const slugAttempt of [slugify(storeName), slugifyWithSuffix(storeName)]) {
    const { data, error } = await supabase.rpc("create_tenant", {
      p_name: storeName,
      p_slug: slugAttempt,
    });

    // TEMP DIAGNOSTIC LOG — remove after investigation. No PII.
    if (error) {
      console.log("CREATE_TENANT_ERROR", { code: error.code, message: error.message });
    } else {
      console.log("CREATE_TENANT_SUCCESS", {
        tenantIdPresent: Boolean((data as unknown as TenantRow | null)?.id),
      });
    }

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
  // call, made after the hash above was computed from the real,
  // checksum-validated document, is trusted to invoke it.
  const { error: trialError } = await createSupabaseServiceRoleClient().rpc(
    "start_trial_for_tenant",
    {
      p_user_id: signUpData.user.id,
      p_tenant_id: tenant.id,
      p_document_hash: documentHash,
    },
  );

  // TEMP DIAGNOSTIC LOG — remove after investigation. No PII.
  if (trialError) {
    console.log("START_TRIAL_ERROR", { code: trialError.code, message: trialError.message });
  } else {
    console.log("START_TRIAL_SUCCESS");
  }

  if (trialError) {
    if (trialError.code === "VX001") {
      redirect("/trial/ja-utilizado");
    }
    return {
      status: "error",
      message: "Não foi possível iniciar seu período de teste. Tente novamente.",
    };
  }

  // TEMP DIAGNOSTIC LOG — remove after investigation. No PII.
  console.log("SIGNUP_REDIRECT", { tenantIdPresent: Boolean(tenant?.id) });

  redirect(`/trial/sucesso?tenant=${tenant.id}`);
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
  redirect(await resolvePostLoginDestination());
}

/**
 * Usa `supabase.auth.resetPasswordForEmail` — o fluxo de recuperação de
 * senha JÁ existe no Supabase Auth (arquitetura §13 Etapa 3), esta ação
 * só o expõe no frontend (prompt Etapa 15 §4). Nenhum sistema novo de
 * autenticação, nenhuma tabela nova.
 *
 * Sempre retorna sucesso, exista ou não o e-mail — mesmo princípio já
 * aplicado em `signInAction`: nunca confirmar/negar se um e-mail está
 * cadastrado.
 */
export async function resetPasswordRequestAction(
  _prevState: ResetPasswordRequestState,
  formData: FormData,
): Promise<ResetPasswordRequestState> {
  const parsed = resetPasswordRequestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { status: "error", message: "Informe um e-mail válido." };
  }

  const supabase = await createSupabaseServerClient();
  const { NEXT_PUBLIC_SITE_URL } = getPublicEnv();
  // D7 (correção) — apontava para /login, um beco sem saída: o usuário
  // clicava no link do e-mail e não tinha como definir a nova senha em
  // lugar nenhum. Agora aponta para a página dedicada de redefinição.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${NEXT_PUBLIC_SITE_URL}/redefinir-senha`,
  });

  return {
    status: "success",
    message: "Se este e-mail estiver cadastrado, você receberá um link para redefinir sua senha.",
  };
}

/**
 * D7 — último passo do fluxo de recuperação de senha. Nunca recebe
 * user_id/tenant_id do navegador: a identidade vem inteiramente da sessão
 * de recovery do Supabase Auth, a mesma que `app/(auth)/redefinir-senha/
 * update-password-form.tsx` já deixou estabelecida via
 * `createSupabaseBrowserClient()` (o link de recuperação do Supabase
 * entrega a sessão como fragmento de URL — `#access_token=...&type=
 * recovery` — que só o client-side consegue ler; `detectSessionInUrl`,
 * padrão do `@supabase/ssr`, processa isso automaticamente ao montar o
 * client e grava a sessão nos cookies, os mesmos que este Server Action
 * lê via `createSupabaseServerClient()`).
 *
 * Por isso `supabase.auth.getUser()` é checado ANTES de qualquer coisa:
 * sem uma sessão válida (link expirado, inválido, já usado, ou a página
 * aberta sem ter vindo do e-mail), `updateUser` nunca é chamado — nunca
 * client-role/service-role bypass, sempre o mecanismo oficial do GoTrue,
 * que só altera a senha do PRÓPRIO usuário da sessão corrente.
 *
 * Sempre desloga a sessão de recovery depois de trocar a senha (mesmo em
 * caso de sucesso) — o usuário entra de novo normalmente com a senha
 * nova pelo `/login` de sempre, nunca fica "logado por acidente" a partir
 * de um link de e-mail.
 */
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

  await supabase.auth.signOut();

  return {
    status: "success",
    message: "Senha atualizada com sucesso. Entre novamente com sua nova senha.",
  };
}
