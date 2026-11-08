import type { Metadata } from "next";

import { BrandMark } from "@/components/ui/brand-mark";
import { UpdatePasswordForm } from "./update-password-form";

export const metadata: Metadata = {
  title: "Redefinir senha — VEXO",
};

/** New recovery links establish a session through /auth/confirm. The
 * browser initializer also supports existing implicit invite links. */
export default async function RedefinirSenhaPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
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
            <h1 className="mb-2 font-headline text-headline-md text-on-surface">Redefinir senha</h1>
            <p className="font-body text-body-md text-on-surface-variant">Escolha uma nova senha para sua conta.</p>
          </div>

          <UpdatePasswordForm invalidLink={Boolean(error)} />
        </div>
      </main>
    </div>
  );
}
