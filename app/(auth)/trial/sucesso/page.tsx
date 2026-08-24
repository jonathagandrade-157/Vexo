import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/ui/brand-mark";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Teste grátis iniciado — VEXO",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/**
 * Recreates `vexo_inicio_do_trial_sucesso` (Stitch). Two deliberate
 * content departures from the mockup's literal copy (structure/tokens
 * unchanged) — noted here and in the Etapa 3 report:
 *   - "Plano Ativo: PRO / AI ENABLED" → no `plans` table exists until
 *     Etapa 8 and no AI feature exists yet, so claiming either would be
 *     inaccurate; relabeled to what's actually true right now.
 *   - "Período de Teste: 30 dias" is computed from the real
 *     trial_records row instead of hardcoded.
 */
export default async function TrialSucessoPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { tenant: tenantId } = await searchParams;

  // TEMP DIAGNOSTIC LOG — remove after investigation. No PII.
  console.log("TRIAL_SUCCESS_PAGE", { tenantIdPresent: Boolean(tenantId) });

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // TEMP DIAGNOSTIC LOG — remove after investigation. No PII.
  console.log("TRIAL_SUCCESS_AUTH", { userPresent: Boolean(user) });

  if (!user) {
    console.log("TRIAL_SUCCESS_REDIRECT_LOGIN");
    redirect("/login");
  }
  if (!tenantId) {
    console.log("TRIAL_SUCCESS_REDIRECT_HOME_NO_TENANT_ID");
    redirect("/");
  }

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("id, name")
    .eq("id", tenantId)
    .single();

  // TEMP DIAGNOSTIC LOG — remove after investigation. No PII.
  console.log("TRIAL_SUCCESS_TENANT", {
    tenantEncontrado: Boolean(tenant),
    ...(tenantError ? { code: tenantError.code, message: tenantError.message } : {}),
  });

  const { data: trial, error: trialError } = await supabase
    .from("trial_records")
    .select("started_at, ends_at")
    .eq("tenant_id", tenantId)
    .single();

  // TEMP DIAGNOSTIC LOG — remove after investigation. No PII.
  console.log("TRIAL_SUCCESS_TRIAL", {
    trialEncontrado: Boolean(trial),
    ...(trialError ? { code: trialError.code, message: trialError.message } : {}),
  });

  // RLS já garante que só um membro do tenant chega aqui com dados — se
  // não achou (tenant de outra conta, id inválido), não há o que mostrar.
  if (!tenant || !trial) {
    console.log("TRIAL_SUCCESS_REDIRECT_HOME_NO_TENANT_OR_TRIAL");
    redirect("/");
  }

  const days = Math.round(
    (new Date(trial.ends_at as string).getTime() -
      new Date(trial.started_at as string).getTime()) /
      (1000 * 60 * 60 * 24),
  );

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden p-margin-mobile md:p-margin-desktop">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center"
      >
        <div className="h-[600px] w-[600px] rounded-full bg-primary-container opacity-[0.03] blur-[100px]" />
      </div>

      <div className="absolute left-8 top-8 z-10">
        <BrandMark icon="eco" />
      </div>

      <main className="relative z-10 w-full max-w-[540px]">
        <div className="ai-glow relative overflow-hidden rounded-xl border border-outline-variant bg-surface-container-low p-8 md:p-10">
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-primary-container to-transparent opacity-50" />

          <div className="mb-10 flex flex-col items-center text-center">
            <div className="relative mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-surface-container-highest bg-surface-container-lowest">
              <div className="absolute inset-0 rounded-full bg-primary-container/10 blur-md" />
              <span className="material-symbols-outlined relative z-10 text-[32px] text-primary">
                rocket_launch
              </span>
            </div>
            <h1 className="mb-3 font-headline text-headline-md text-on-surface">
              Seu teste grátis começou! 🎉
            </h1>
            <p className="mx-auto max-w-[80%] font-body text-body-md text-on-surface-variant">
              A loja <strong className="text-on-surface">{tenant.name}</strong>{" "}
              foi criada e seu período de teste está ativo.
            </p>
          </div>

          <div className="mb-8 grid grid-cols-2 gap-4">
            <div className="flex flex-col justify-center rounded-lg border border-surface-container-highest bg-surface-container-lowest p-4">
              <span className="mb-1 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
                Plano
              </span>
              <div className="flex items-center gap-2">
                <span className="font-headline text-headline-sm text-on-surface">Teste</span>
                <span className="rounded border border-primary-container/30 bg-primary-container/20 px-2 py-0.5 font-label text-label-sm text-primary">
                  GRÁTIS
                </span>
              </div>
            </div>
            <div className="flex flex-col justify-center rounded-lg border border-surface-container-highest bg-surface-container-lowest p-4">
              <span className="mb-1 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
                Período de teste
              </span>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-on-surface-variant">
                  schedule
                </span>
                <span className="font-headline text-headline-sm text-on-surface">{days} dias</span>
              </div>
            </div>
            <div className="flex flex-col justify-center rounded-lg border border-surface-container-highest bg-surface-container-lowest p-4">
              <span className="mb-1 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
                Cartão de crédito
              </span>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-[#10B981]">
                  check_circle
                </span>
                <span className="font-body text-body-md text-on-surface">Não exigido</span>
              </div>
            </div>
            <div className="flex flex-col justify-center rounded-lg border border-surface-container-highest bg-surface-container-lowest p-4">
              <span className="mb-1 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
                Próxima fatura
              </span>
              <span className="font-headline text-headline-sm text-on-surface">R$ 0,00</span>
            </div>
          </div>

          <div className="mb-8 flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-surface-container-highest bg-surface-container-lowest px-4 py-2">
              <span className="material-symbols-outlined text-[16px] text-primary">info</span>
              <p className="font-body text-body-sm text-on-surface-variant">
                Você não será cobrado durante os {days} dias de teste.
              </p>
            </div>
          </div>

          <Link
            className="group flex w-full items-center justify-center gap-2 rounded-lg bg-[#7C3AED] px-6 py-4 font-label text-label-md text-white shadow-[0_0_20px_rgba(124,58,237,0.2)] transition-all duration-200 hover:bg-[#6D28D9] hover:shadow-[0_0_30px_rgba(124,58,237,0.4)]"
            href="/onboarding"
          >
            <span className="material-symbols-outlined">storefront</span>
            Configurar minha loja
            <span className="material-symbols-outlined -ml-4 opacity-0 transition-all duration-300 group-hover:ml-0 group-hover:opacity-100">
              arrow_forward
            </span>
          </Link>
        </div>

        <p className="mt-4 text-center font-label text-label-sm text-on-surface-variant">
          Trial iniciado em {formatDate(trial.started_at as string)} · válido até{" "}
          {formatDate(trial.ends_at as string)}
        </p>
      </main>
    </div>
  );
}
