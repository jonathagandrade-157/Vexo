"use client";

import { useActionState } from "react";
import Link from "next/link";

import { TextField } from "@/components/ui/text-field";
import { SubmitButton } from "@/components/ui/submit-button";
import { resetPasswordRequestAction } from "@/features/auth/actions";
import { initialResetPasswordRequestState } from "@/features/auth/schema";

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(resetPasswordRequestAction, initialResetPasswordRequestState);

  if (state.status === "success") {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-surface-container-highest bg-surface-container-lowest p-6 text-center shadow-2xl md:p-8">
        <span className="material-symbols-outlined text-4xl text-primary">mark_email_read</span>
        <p className="font-body text-body-md text-on-surface">{state.message}</p>
        <Link className="font-label text-label-md text-primary transition-colors hover:text-primary-fixed-dim" href="/login">
          Voltar para o login
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="relative space-y-6 overflow-hidden rounded-xl border border-surface-container-highest bg-surface-container-lowest p-6 shadow-2xl md:p-8" noValidate>
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary-container/50 to-transparent" />

      <TextField
        autoComplete="email"
        icon="mail"
        id="email"
        label="E-mail"
        name="email"
        placeholder="maria@empresa.com"
        type="email"
      />

      {state.status === "error" && state.message ? (
        <p className="rounded-lg border border-error/30 bg-error-container/10 px-4 py-2 text-body-sm text-error" role="alert">
          {state.message}
        </p>
      ) : null}

      <div className="pt-4">
        <SubmitButton pendingLabel="Enviando…">Enviar link de recuperação</SubmitButton>
      </div>

      <div className="mt-6 text-center">
        <p className="font-body text-body-sm text-on-surface-variant">
          Lembrou sua senha?{" "}
          <Link className="font-medium text-primary transition-colors hover:text-primary-fixed-dim" href="/login">
            Entrar
          </Link>
        </p>
      </div>
    </form>
  );
}
