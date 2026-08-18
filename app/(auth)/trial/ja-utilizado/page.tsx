import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Acesso indisponível — VEXO",
};

/**
 * Recreates `vexo_erro_trial_j_utilizado` (Stitch). Reached only after
 * public.start_trial_for_tenant() rejects with TRIAL_ALREADY_USED, or a
 * profiles.cpf_hash unique-violation during signup (features/auth/
 * actions.ts) — never guessed or set by the client.
 */
export default function TrialJaUtilizadoPage() {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-[800px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-container/5 blur-[120px]"
      />

      <main className="relative z-10 flex w-full max-w-md flex-col items-center px-margin-mobile md:px-0">
        <div className="mb-10 text-center">
          <span className="font-display text-display-lg-mobile text-primary tracking-tight md:text-display-lg">
            VEXO
          </span>
        </div>

        <div className="group relative flex w-full flex-col items-center overflow-hidden rounded-xl border border-outline-variant bg-surface-container-low p-8 text-center shadow-2xl">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-outline-variant bg-surface-container-high">
            <span className="material-symbols-outlined text-3xl text-outline">
              info
            </span>
          </div>

          <h1 className="mb-3 font-headline text-headline-sm text-on-surface">
            Acesso indisponível
          </h1>
          <p className="mb-10 max-w-[280px] font-body text-body-md leading-relaxed text-on-surface-variant">
            Este CPF/CNPJ já utilizou o período de teste gratuito da VEXO.
          </p>

          <div className="flex w-full flex-col gap-3">
            <Link
              className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary-container font-label text-label-md text-on-primary-container shadow-[0_0_20px_rgba(124,58,237,0.15)] transition-colors duration-200 hover:bg-primary hover:shadow-[0_0_25px_rgba(124,58,237,0.3)]"
              href="/"
            >
              Ver planos pagos
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </Link>
            <Link
              className="flex h-12 w-full items-center justify-center rounded-lg border border-outline-variant bg-transparent font-label text-label-md text-on-surface-variant transition-colors duration-200 hover:bg-surface-container-high hover:text-on-surface"
              href="/login"
            >
              Entrar na minha conta
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
