/**
 * JON-17 — "Dia 10+: bloquear também a loja pública". Deliberadamente
 * distinto de `StorefrontNotFound`: aqui o slug existe e a loja é real
 * (nunca confundido com "endereço não corresponde a nenhuma loja"), só
 * temporariamente fora do ar — mas o motivo (inadimplência) nunca é
 * exposto ao visitante, só "indisponível no momento" (mesmo princípio de
 * `is_storefront_blocked()`: devolve só um boolean, nunca a razão).
 */
export function StorefrontUnavailable() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-margin-mobile text-center md:p-margin-desktop">
      <span className="material-symbols-outlined text-4xl text-on-surface-variant">storefront</span>
      <div className="flex max-w-[440px] flex-col gap-2">
        <h1 className="font-headline text-headline-md text-on-surface">Loja temporariamente indisponível</h1>
        <p className="font-body text-body-md text-on-surface-variant">
          Esta loja está temporariamente fora do ar. Tente novamente mais tarde.
        </p>
      </div>
    </div>
  );
}
