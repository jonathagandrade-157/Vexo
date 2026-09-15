"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import "./globals.css";

/**
 * JON-14 — só dispara quando o próprio Root Layout (app/layout.tsx)
 * lança durante a renderização — nunca para um erro comum de página
 * (esses continuam em app/error.tsx, se/quando existir). Por isso
 * precisa da própria <html>/<body>: substitui a árvore inteira, não
 * herda nada do layout que acabou de falhar. Reimporta globals.css pelo
 * mesmo motivo (o import do layout.tsx não é aproveitado aqui).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body className="bg-background font-body text-on-background antialiased">
        <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-8 text-center">
          <div className="flex max-w-[440px] flex-col gap-2">
            <h1 className="font-headline text-headline-md text-on-surface">Algo deu errado</h1>
            <p className="font-body text-body-md text-on-surface-variant">
              Nossa equipe já foi notificada. Tente novamente em alguns instantes.
            </p>
          </div>
          <button
            className="rounded-lg bg-primary-container px-5 py-2.5 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6]"
            onClick={() => reset()}
            type="button"
          >
            Tentar novamente
          </button>
        </div>
      </body>
    </html>
  );
}
