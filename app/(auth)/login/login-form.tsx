"use client";

import { useActionState } from "react";
import Link from "next/link";

import { TextField } from "@/components/ui/text-field";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialSignInState, signInAction } from "@/features/auth/actions";

export function LoginForm() {
  const [state, formAction] = useActionState(signInAction, initialSignInState);

  return (
    <form action={formAction} className="relative space-y-6 overflow-hidden rounded-xl border border-surface-container-highest bg-surface-container-lowest p-6 shadow-2xl md:p-8" noValidate>
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary-container/50 to-transparent" />

      <div className="space-y-4">
        <TextField
          id="email"
          name="email"
          label="E-mail"
          icon="mail"
          type="email"
          placeholder="maria@empresa.com"
          autoComplete="email"
          error={state.fieldErrors?.email}
        />
        <TextField
          id="password"
          name="password"
          label="Senha"
          icon="lock"
          type="password"
          placeholder="••••••••"
          autoComplete="current-password"
          error={state.fieldErrors?.password}
        />
        <div className="text-right">
          <Link className="font-label text-label-sm text-on-surface-variant transition-colors hover:text-primary" href="/recuperar-senha">
            Esqueci minha senha
          </Link>
        </div>
      </div>

      {state.status === "error" && state.message ? (
        <p className="rounded-lg border border-error/30 bg-error-container/10 px-4 py-2 text-body-sm text-error" role="alert">
          {state.message}
        </p>
      ) : null}

      <div className="pt-4">
        <SubmitButton pendingLabel="Entrando…">Entrar</SubmitButton>
      </div>

      <div className="mt-6 text-center">
        <p className="font-body text-body-sm text-on-surface-variant">
          Ainda não tem uma conta?{" "}
          <Link className="font-medium text-primary transition-colors hover:text-primary-fixed-dim" href="/cadastro">
            Criar conta
          </Link>
        </p>
      </div>
    </form>
  );
}
