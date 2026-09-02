import { NotificationBell } from "@/components/painel/notification-bell";
import type { NotificationRow } from "@/features/notifications/schema";

/**
 * Header do painel — adaptado de `vexo_dashboard_principal_desktop`/
 * `_mobile`. Uma omissão de conteúdo deliberada em relação ao mockup
 * (mesmo padrão da Etapa 3: ajustar o que o mockup mostra para o que
 * existe de verdade, sem tocar tokens/estrutura): a barra de busca (não
 * há produtos/pedidos/clientes para buscar ainda). O sino de
 * notificações (D14.1) passa a existir de verdade — a lista/contador vêm
 * prontos do servidor (`app/painel/layout.tsx`), nunca inventados aqui.
 */
export function Header({
  userInitial,
  userName,
  notifications,
  unreadNotificationCount,
}: {
  userInitial: string;
  userName: string;
  notifications: NotificationRow[];
  unreadNotificationCount: number;
}) {
  return (
    <header className="fixed left-0 top-0 z-40 flex h-16 w-full items-center justify-between border-b border-outline-variant bg-surface/80 px-margin-mobile backdrop-blur-md md:left-[260px] md:w-[calc(100%-260px)] md:px-margin-desktop">
      <span className="font-headline text-headline-sm font-black tracking-tight text-primary md:hidden">
        VEXO
      </span>
      <div className="hidden flex-1 md:block" />
      <div className="flex items-center gap-2">
        <NotificationBell initialNotifications={notifications} initialUnreadCount={unreadNotificationCount} />
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full border border-surface-container-highest bg-surface-container-high font-label text-label-md text-on-surface"
          title={userName}
        >
          {userInitial}
        </div>
      </div>
    </header>
  );
}
