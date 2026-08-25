"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import { TextField } from "@/components/ui/text-field";
import { SubmitButton } from "@/components/ui/submit-button";
import { signInAction } from "@/features/auth/actions";
import { initialSignInState } from "@/features/auth/schema";

/**
 * Etapa 19.1 — card de login, visualmente redesenhado (glass sutil, glow
 * roxo discreto, hierarquia de "produto SaaS premium"), mas chamando
 * exatamente a mesma `signInAction` de sempre (Etapa 19) — nenhuma
 * mudança de lógica, só de apresentação.
 *
 * "Lembrar de mim" é apresentado aqui só como controle visual: o checkbox
 * não é lido por `signInAction` (que só valida email/password) nem afeta
 * a duração da sessão do Supabase Auth — implementar isso de verdade
 * exigiria mudar a configuração de sessão, fora do escopo desta etapa
 * (que é exclusivamente visual). Registrado aqui em vez de silenciosamente
 * fingir que faz algo.
 */
export function LoginForm() {
  const [state, formAction] = useActionState(signInAction, initialSignInState);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form
      action={formAction}
      className="relative space-y-6 overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container-lowest/90 p-6 shadow-2xl shadow-black/40 backdrop-blur-xl md:p-10"
      noValidate
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary-container/60 to-transparent" />
      <div
        aria-hidden
        className="ai-glow pointer-events-none absolute -top-16 left-1/2 h-32 w-64 -translate-x-1/2 rounded-full bg-primary-container/20 blur-3xl"
      />

      <div className="relative text-center lg:text-left">
        <h1 className="font-headline text-headline-md text-on-surface">Bem-vindo de volta! 👋</h1>
        <p className="mt-2 font-body text-body-md text-on-surface-variant">Acesse sua conta VEXO</p>
      </div>

      <div className="relative space-y-4">
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
          type={showPassword ? "text" : "password"}
          placeholder="••••••••"
          autoComplete="current-password"
          error={state.fieldErrors?.password}
          rightSlot={
            <button
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant transition-colors hover:text-primary"
              onClick={() => setShowPassword((v) => !v)}
              type="button"
            >
              <span className="material-symbols-outlined text-sm">
                {showPassword ? "visibility_off" : "visibility"}
              </span>
            </button>
          }
        />

        <div className="flex items-center justify-between gap-4 pt-1">
          <label className="flex items-center gap-2 font-body text-body-sm text-on-surface-variant">
            <input
              className="h-4 w-4 rounded border-surface-container-highest bg-surface-container-lowest text-primary focus:ring-1 focus:ring-primary"
              name="rememberMe"
              type="checkbox"
            />
            Lembrar de mim
          </label>
          <Link
            className="font-label text-label-sm text-on-surface-variant transition-colors hover:text-primary"
            href="/recuperar-senha"
          >
            Esqueceu sua senha?
          </Link>
        </div>
      </div>

      {state.status === "error" && state.message ? (
        <p className="relative rounded-lg border border-error/30 bg-error-container/10 px-4 py-2 text-body-sm text-error" role="alert">
          {state.message}
        </p>
      ) : null}

      <div className="relative">
        <SubmitButton pendingLabel="Entrando…">Entrar no VEXO</SubmitButton>
      </div>

      <div className="relative flex items-center gap-4">
        <div className="h-px flex-1 bg-outline-variant/20" />
        <span className="font-label text-label-sm uppercase text-on-surface-variant">ou</span>
        <div className="h-px flex-1 bg-outline-variant/20" />
      </div>

      <Link
        className="relative flex w-full items-center justify-center gap-2 rounded-lg border border-outline-variant/40 py-3 font-body text-body-md font-medium text-on-surface transition-colors hover:border-primary/50 hover:text-primary"
        href="/cadastro"
      >
        <span className="material-symbols-outlined text-[18px]">storefront</span>
        Criar minha loja
      </Link>

      <p className="relative text-center font-label text-label-sm text-on-surface-variant">
        Ao continuar, você concorda com nossos Termos de Uso e Política de Privacidade.
      </p>
    </form>
  );
}
