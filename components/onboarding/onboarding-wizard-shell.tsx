import Link from "next/link";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/ui/brand-mark";

/**
 * D12.2 — chrome comum a toda etapa do wizard: barra de progresso,
 * "Etapa X de Y" e título/descrição da etapa. Server Component puro (sem
 * `"use client"`) — `currentStepNumber`/`totalSteps`/`percentage` chegam
 * já calculados por `calculateOnboardingProgress`
 * (features/onboarding/progress-logic.ts), nunca hardcoded aqui (D12.2:
 * "NÃO escrever width: '12.5%'", "NÃO escrever 'Etapa 1 de 8' como texto
 * fixo") — este componente só formata os números recebidos.
 *
 * `backHref` opcional: quando ausente (primeira etapa alcançável), o
 * link "Voltar" simplesmente não é renderizado, em vez de apontar para
 * uma etapa inalcançável.
 */
export function OnboardingWizardShell({
  title,
  description,
  currentStepNumber,
  totalSteps,
  percentage,
  backHref,
  children,
}: {
  title: string;
  description: string;
  currentStepNumber: number;
  totalSteps: number;
  percentage: number;
  backHref?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="h-1 w-full border-b border-outline-variant/20 bg-surface-container-lowest">
        <div
          className="h-full bg-primary-container transition-all duration-500"
          style={{ width: `${percentage}%` }}
        />
      </div>

      <header className="flex items-center justify-between px-margin-mobile py-6 md:px-margin-desktop">
        <BrandMark icon="auto_awesome" />
        <span className="font-label text-label-sm uppercase tracking-widest text-on-surface-variant">
          Etapa {currentStepNumber} de {totalSteps}
        </span>
      </header>

      <main className="flex flex-grow items-center justify-center px-margin-mobile py-12 md:px-margin-desktop">
        <div className="flex w-full max-w-[600px] flex-col gap-10">
          <div className="flex flex-col gap-3">
            {backHref ? (
              <Link
                className="flex w-fit items-center gap-1 font-label text-label-sm text-on-surface-variant transition-colors hover:text-primary"
                href={backHref}
              >
                <span className="material-symbols-outlined text-lg">arrow_back</span>
                Voltar
              </Link>
            ) : null}
            <div className="flex flex-col gap-3 text-center md:text-left">
              <h1 className="font-headline text-headline-md text-on-surface md:text-display-lg">{title}</h1>
              <p className="font-body text-body-lg text-on-surface-variant">{description}</p>
            </div>
          </div>

          {children}
        </div>
      </main>
    </div>
  );
}
