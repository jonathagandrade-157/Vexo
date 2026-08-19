import Link from "next/link";

/**
 * Estado 1 (arquitetura §6 Etapa 6) — sem shell/header de loja nenhuma:
 * não há nome, nem qualquer outro dado de tenant para mostrar (o slug
 * não resolveu, ou resolveu para uma loja suspensa/excluída — o
 * visitante nunca sabe qual dos dois, `resolveStorefrontTenant` já
 * unifica isso num único `not_found`).
 */
export function StorefrontNotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-margin-mobile text-center md:p-margin-desktop">
      <span className="material-symbols-outlined text-4xl text-on-surface-variant">storefront</span>
      <div className="flex max-w-[440px] flex-col gap-2">
        <h1 className="font-headline text-headline-md text-on-surface">Loja não encontrada</h1>
        <p className="font-body text-body-md text-on-surface-variant">
          O endereço que você acessou não corresponde a nenhuma loja ativa na VEXO.
        </p>
      </div>
      <Link
        className="rounded-lg border border-outline-variant px-6 py-2.5 font-label text-label-md text-on-surface transition-colors hover:border-primary/50 hover:text-primary"
        href="/"
      >
        Voltar para a VEXO
      </Link>
    </div>
  );
}
