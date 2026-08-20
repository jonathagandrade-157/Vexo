"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import { TextField } from "@/components/ui/text-field";
import { SubmitButton } from "@/components/ui/submit-button";
import { signUpAction } from "@/features/auth/actions";
import { initialSignUpState } from "@/features/auth/schema";

export function SignUpForm() {
  const [state, formAction] = useActionState(signUpAction, initialSignUpState);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [termsError, setTermsError] = useState<string | undefined>(undefined);

  const passwordsMatch = confirmPassword.length === 0 || password === confirmPassword;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const termsAccepted = (form.elements.namedItem("acceptTerms") as HTMLInputElement | null)?.checked ?? false;

    if (password !== confirmPassword) {
      event.preventDefault();
      return;
    }

    if (!termsAccepted) {
      event.preventDefault();
      setTermsError("É necessário aceitar os termos para continuar.");
      return;
    }

    setTermsError(undefined);
  }

  return (
    <form
      action={formAction}
      className="relative space-y-6 overflow-hidden rounded-xl border border-surface-container-highest bg-surface-container-lowest p-6 shadow-2xl md:p-8"
      noValidate
      onSubmit={handleSubmit}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary-container/50 to-transparent" />

      <div className="space-y-4">
        <TextField
          id="storeName"
          name="storeName"
          label="Nome da loja"
          icon="storefront"
          placeholder="Minha Loja Incrível"
          autoComplete="organization"
          error={state.fieldErrors?.storeName}
        />
        <TextField
          id="fullName"
          name="fullName"
          label="Nome completo"
          icon="person"
          placeholder="Maria Silva"
          autoComplete="name"
          error={state.fieldErrors?.fullName}
        />
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TextField
            id="phone"
            name="phone"
            label="Telefone"
            icon="call"
            type="tel"
            placeholder="(00) 00000-0000"
            autoComplete="tel"
            error={state.fieldErrors?.phone}
          />
          <TextField
            id="document"
            name="document"
            label="CPF / CNPJ"
            icon="badge"
            placeholder="000.000.000-00"
            error={state.fieldErrors?.document}
          />
        </div>
        <TextField
          id="password"
          name="password"
          label="Senha"
          icon="lock"
          type={showPassword ? "text" : "password"}
          placeholder="••••••••"
          autoComplete="new-password"
          error={state.fieldErrors?.password}
          onChange={setPassword}
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
        <TextField
          error={confirmTouched && !passwordsMatch ? "As senhas não coincidem" : undefined}
          icon="lock"
          id="confirmPassword"
          label="Confirmar senha"
          name="confirmPassword"
          onChange={(value) => {
            setConfirmPassword(value);
            setConfirmTouched(true);
          }}
          placeholder="••••••••"
          type={showPassword ? "text" : "password"}
        />
        <label className="flex items-start gap-2.5">
          <input
            className="mt-0.5 h-4 w-4 rounded border-surface-container-highest bg-surface-container-lowest text-primary focus:ring-1 focus:ring-primary"
            name="acceptTerms"
            onChange={() => setTermsError(undefined)}
            type="checkbox"
          />
          <span className="font-body text-body-sm text-on-surface-variant">
            Li e aceito os termos de uso e a política de privacidade da VEXO.
          </span>
        </label>
        {termsError ? (
          <p className="text-label-sm text-error" role="alert">
            {termsError}
          </p>
        ) : null}
      </div>

      {state.status === "error" && state.message ? (
        <p className="rounded-lg border border-error/30 bg-error-container/10 px-4 py-2 text-body-sm text-error" role="alert">
          {state.message}
        </p>
      ) : null}

      <div className="pt-4">
        <SubmitButton pendingLabel="Criando sua conta…">
          Começar teste grátis
        </SubmitButton>
      </div>

      <div className="mt-6 border-t border-surface-container-highest pt-4 text-center">
        <p className="flex items-center justify-center gap-2 font-label text-label-sm text-on-surface-variant">
          <span className="material-symbols-outlined text-[14px]">info</span>
          Seus dados são utilizados para identificar sua conta e controlar a
          elegibilidade do período de teste.
        </p>
      </div>
    </form>
  );
}

export function SignInLink() {
  return (
    <div className="mt-8 text-center">
      <p className="font-body text-body-sm text-on-surface-variant">
        Já tem uma conta?{" "}
        <Link className="font-medium text-primary transition-colors hover:text-primary-fixed-dim" href="/login">
          Entrar
        </Link>
      </p>
    </div>
  );
}
