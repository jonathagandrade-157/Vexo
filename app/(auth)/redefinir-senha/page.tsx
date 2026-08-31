import type { Metadata } from "next";

import { BrandMark } from "@/components/ui/brand-mark";
import { UpdatePasswordForm } from "./update-password-form";

export const metadata: Metadata = {
  title: "Redefinir senha — VEXO",
};

/**
 * D7 — página de destino do link de recuperação de senha (`redirectTo` de
 * `resetPasswordRequestAction`). Mesmo shell visual de `/recuperar-senha`/
 * `/login` (prompt: reaproveitar padrão existente, não inventar um novo).
 *
 * Deliberadamente NÃO é um Server Component que já checa a sessão aqui:
 * o Supabase entrega a sessão de recovery como fragmento de URL
 * (`#access_token=...`), que o servidor nunca recebe (fragmentos de URL
 * não são enviados em requisições HTTP) — só o client-side, via
 * `createSupabaseBrowserClient()` (`detectSessionInUrl`, padrão do
 * `@supabase/ssr`), consegue processar isso. Por isso toda a checagem de
 * "existe uma sessão de recovery válida?" vive em
 * `UpdatePasswordForm` (Client Component).
 */
export default function RedefinirSenhaPage() {
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

          <UpdatePasswordForm />
        </div>
      </main>
    </div>
  );
}
