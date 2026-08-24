import Link from "next/link";

/**
 * Etapa 16 §11 — UX de limite: mostra o uso atual antes de o lojista
 * bater no teto (não só a mensagem de erro depois de tentar), e destaca
 * quando o limite foi atingido. `limit === null` (sem limite configurado
 * para o plano — não deveria acontecer para BASIC/INTERMEDIATE/PRO após o
 * seed desta etapa) não renderiza nada, silenciosamente — o servidor
 * segue sendo a validação real (features/products|categories/actions.ts),
 * este componente é só apresentação.
 */
export function PlanLimitIndicator({
  count,
  limit,
  resourceLabel,
}: {
  count: number;
  /** -1 = ilimitado (mesmo sentinel de plan_limits), null = não configurado. */
  limit: number | null;
  resourceLabel: string;
}) {
  if (limit === null || limit === -1) return null;

  const reached = count >= limit;
  const pct = Math.min(100, Math.round((count / limit) * 100));

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-outline-variant/30 bg-surface-container-low px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-label text-label-sm text-on-surface-variant">
          {count} de {limit} {resourceLabel} do seu plano
        </p>
        {reached ? (
          <span className="rounded-full bg-error/10 px-2 py-0.5 font-label text-label-sm uppercase text-error">Limite atingido</span>
        ) : null}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest">
        <div
          className={reached ? "h-full rounded-full bg-error" : "h-full rounded-full bg-primary"}
          style={{ width: `${pct}%` }}
        />
      </div>
      {reached ? (
        <p className="font-body text-body-sm text-on-surface-variant">
          Você atingiu o limite de {limit} {resourceLabel} do seu plano atual. Faça upgrade para continuar cadastrando.{" "}
          <Link className="font-medium text-primary hover:text-primary-fixed-dim" href="/painel/assinatura">
            Ver planos
          </Link>
        </p>
      ) : null}
    </div>
  );
}
