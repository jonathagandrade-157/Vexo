"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";

import { TextField } from "@/components/ui/text-field";
import { SubmitButton } from "@/components/ui/submit-button";
import { updatePasswordAction } from "@/features/auth/actions";
import { initialUpdatePasswordState } from "@/features/auth/schema";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type SessionCheck = "checking" | "ready" | "invalid";

/** Session presence controls presentation only. The server action verifies
 * the user before updating that user's password. An explicit callback error
 * hides the form even when the browser already has another valid session.
 * Implicit invite fragments are handled explicitly below (the SSR browser
 * client is PKCE-only). */
export function UpdatePasswordForm({ invalidLink = false }: { invalidLink?: boolean }) {
  const [sessionCheck, setSessionCheck] = useState<SessionCheck>("checking");
  const [state, formAction] = useActionState(updatePasswordAction, initialUpdatePasswordState);

  useEffect(() => {
    if (invalidLink) return;
    const supabase = createSupabaseBrowserClient();
    let active = true;

    // Convites do Supabase Auth (admin.inviteUserByEmail) voltam pelo fluxo
    // implícito, com tokens no fragmento. O cliente do @supabase/ssr é PKCE
    // e recusa esse retorno ("Not a valid PKCE flow url"), então o convite
    // nunca abria o formulário. Só o fragmento de convite é aceito aqui: a
    // URL é limpa antes de qualquer outra coisa (tokens fora do histórico,
    // do Referer e de capturas) e a sessão é validada pelo Auth via setSession.
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = fragment.get("access_token");
    const refreshToken = fragment.get("refresh_token");
    const hasAuthFragment = fragment.has("access_token") || fragment.has("error") || fragment.has("error_code");
    if (hasAuthFragment) window.history.replaceState(null, "", window.location.pathname + window.location.search);

    if (hasAuthFragment && fragment.get("type") === "invite" && accessToken && refreshToken && !fragment.has("error")) {
      supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ data, error }) => {
        if (active) setSessionCheck(!error && data.session ? "ready" : "invalid");
      });
    } else if (hasAuthFragment) {
      // Erro do provedor ou fragmento que não é convite: nunca abre o formulário.
      void Promise.resolve().then(() => {
        if (active) setSessionCheck("invalid");
      });
    } else {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (active) setSessionCheck(session ? "ready" : "invalid");
      });
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setSessionCheck("ready");
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [invalidLink]);

  if (!invalidLink && sessionCheck === "checking") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-surface-container-highest bg-surface-container-lowest p-6 text-center shadow-2xl md:p-8">
        <p className="font-body text-body-md text-on-surface-variant">Verificando seu link…</p>
      </div>
    );
  }

  if (invalidLink || sessionCheck === "invalid") {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-surface-container-highest bg-surface-container-lowest p-6 text-center shadow-2xl md:p-8">
        <span className="material-symbols-outlined text-4xl text-error">link_off</span>
        <p className="font-body text-body-md text-on-surface">
          Este link de redefinição é inválido ou já expirou.
        </p>
        <Link className="font-label text-label-md text-primary transition-colors hover:text-primary-fixed-dim" href="/recuperar-senha">
          Solicitar um novo link
        </Link>
      </div>
    );
  }

  if (state.status === "success") {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-surface-container-highest bg-surface-container-lowest p-6 text-center shadow-2xl md:p-8">
        <span className="material-symbols-outlined text-4xl text-primary">check_circle</span>
        <p className="font-body text-body-md text-on-surface">{state.message}</p>
        <Link className="font-label text-label-md text-primary transition-colors hover:text-primary-fixed-dim" href="/login">
          Ir para o login
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="relative space-y-6 overflow-hidden rounded-xl border border-surface-container-highest bg-surface-container-lowest p-6 shadow-2xl md:p-8" noValidate>
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary-container/50 to-transparent" />

      <TextField
        autoComplete="new-password"
        error={state.fieldErrors?.password}
        icon="lock"
        id="password"
        label="Nova senha"
        name="password"
        placeholder="••••••••"
        type="password"
      />
      <TextField
        autoComplete="new-password"
        error={state.fieldErrors?.confirmPassword}
        icon="lock"
        id="confirmPassword"
        label="Confirme a nova senha"
        name="confirmPassword"
        placeholder="••••••••"
        type="password"
      />

      {state.status === "error" && state.message ? (
        <p className="rounded-lg border border-error/30 bg-error-container/10 px-4 py-2 text-body-sm text-error" role="alert">
          {state.message}
        </p>
      ) : null}

      <div className="pt-4">
        <SubmitButton pendingLabel="Salvando…">Salvar nova senha</SubmitButton>
      </div>
    </form>
  );
}
