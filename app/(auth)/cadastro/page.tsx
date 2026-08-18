import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/ui/brand-mark";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SignInLink, SignUpForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Criar conta — VEXO",
};

/**
 * Recreates `vexo_criar_conta_e_elegibilidade_trial` (Stitch) as a real,
 * functional screen — structure/tokens preserved 1:1, copy localized to
 * pt-BR to match the rest of the product (the export itself mixed English
 * labels with a Portuguese footer note).
 */
export default async function CadastroPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/");

  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-hidden">
      <header className="z-50 flex w-full justify-center px-margin-mobile py-8 lg:absolute lg:left-0 lg:top-0 lg:justify-start lg:px-margin-desktop">
        <BrandMark />
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-container-max flex-grow items-center justify-center p-margin-mobile md:p-margin-desktop">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden opacity-30 mix-blend-screen"
        >
          <div className="h-[800px] w-[800px] -translate-y-1/4 transform rounded-full bg-primary-container opacity-20 blur-[150px]" />
        </div>

        <div className="relative z-10 w-full max-w-[480px]">
          <div className="mb-10 text-center lg:text-left">
            <h1 className="mb-2 font-headline text-headline-md text-on-surface">
              Crie sua conta
            </h1>
            <p className="font-body text-body-md text-on-surface-variant">
              Preencha seus dados para começar a usar a VEXO.
            </p>
          </div>

          <SignUpForm />
          <SignInLink />
        </div>
      </main>
    </div>
  );
}
