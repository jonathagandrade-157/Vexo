/**
 * Header do painel — adaptado de `vexo_dashboard_principal_desktop`/
 * `_mobile`. Duas omissões de conteúdo deliberadas em relação ao mockup
 * (mesmo padrão da Etapa 3: ajustar o que o mockup mostra para o que
 * existe de verdade, sem tocar tokens/estrutura): a barra de busca (não
 * há produtos/pedidos/clientes para buscar ainda) e o sino de
 * notificações com indicador de não-lidas (não existe sistema de
 * notificação nenhum ainda — mostrar o indicador seria inventar dado).
 */
export function Header({ userInitial, userName }: { userInitial: string; userName: string }) {
  return (
    <header className="fixed left-0 top-0 z-40 flex h-16 w-full items-center justify-between border-b border-outline-variant bg-surface/80 px-margin-mobile backdrop-blur-md md:left-[260px] md:w-[calc(100%-260px)] md:px-margin-desktop">
      <span className="font-headline text-headline-sm font-black tracking-tight text-primary md:hidden">
        VEXO
      </span>
      <div className="hidden flex-1 md:block" />
      <div
        className="flex h-8 w-8 items-center justify-center rounded-full border border-surface-container-highest bg-surface-container-high font-label text-label-md text-on-surface"
        title={userName}
      >
        {userInitial}
      </div>
    </header>
  );
}
