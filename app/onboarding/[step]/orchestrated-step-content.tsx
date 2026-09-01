import { OnboardingStepActions } from "@/components/onboarding/onboarding-step-actions";

/**
 * D12.2.1 — corpo comum das 5 etapas `skippable` (identidade, produtos,
 * categorias, pagamentos, entrega): não têm formulário próprio dentro do
 * wizard nesta fase (ver `features/onboarding/step-definitions.ts`, nota
 * no tipo `OnboardingStepKind`, para o motivo — as Server Actions dessas
 * áreas recusam operar enquanto o onboarding está pendente). "Continuar"
 * marca a etapa como `completed`; "Pular por enquanto" marca como
 * `skipped` — os dois avançam para a próxima etapa, nenhum bloqueia o
 * onboarding. A configuração real acontece na área correspondente do
 * painel, disponível assim que a loja é publicada (última etapa).
 */
export function OrchestratedStepContent({
  stepKey,
  nextHref,
  headline,
  subtext,
  continueLabel,
}: {
  stepKey: string;
  nextHref: string;
  headline: string;
  subtext: string;
  continueLabel: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-6">
        <p className="font-headline text-headline-sm text-on-surface">{headline}</p>
        <p className="font-body text-body-md text-on-surface-variant">{subtext}</p>
      </div>
      <OnboardingStepActions continueLabel={continueLabel} nextHref={nextHref} stepKey={stepKey} />
    </div>
  );
}
