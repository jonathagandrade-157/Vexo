"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { markAllNotificationsReadAction, markNotificationReadAction } from "@/features/notifications/actions";
import { notificationTargetHref, type NotificationRow } from "@/features/notifications/schema";

function timeAgo(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

/**
 * D14.1 — sino de notificações do painel (antes só um comentário no
 * Header explicando por que não existia: "não existe sistema de
 * notificação nenhum ainda — mostrar o indicador seria inventar dado").
 * Lista já vem pronta do servidor (`app/painel/layout.tsx`, uma leitura
 * por request) — este componente só abre/fecha o dropdown e chama as
 * Server Actions de marcar como lida; nunca cria notificação nenhuma (a
 * única origem é o trigger `notify_new_order`, banco).
 */
export function NotificationBell({
  initialNotifications,
  initialUnreadCount,
}: {
  initialNotifications: NotificationRow[];
  initialUnreadCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="relative">
      <button
        aria-expanded={open}
        aria-label={initialUnreadCount > 0 ? `Notificações — ${initialUnreadCount} não lida(s)` : "Notificações"}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span className="material-symbols-outlined text-[22px]">notifications</span>
        {initialUnreadCount > 0 ? (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 font-label text-[10px] leading-none text-on-error">
            {initialUnreadCount > 9 ? "9+" : initialUnreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          {/* Fecha ao clicar fora — mesmo padrão simples já usado em menus do painel (sem lib nova). */}
          <button aria-hidden className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} tabIndex={-1} type="button" />
          <div className="absolute right-0 z-50 mt-2 flex w-80 flex-col overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container-lowest shadow-xl">
            <div className="flex items-center justify-between border-b border-outline-variant/20 px-4 py-3">
              <span className="font-label text-label-md text-on-surface">Notificações</span>
              {initialUnreadCount > 0 ? (
                <button
                  className="font-label text-label-sm text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isPending}
                  onClick={() => startTransition(() => markAllNotificationsReadAction())}
                  type="button"
                >
                  Marcar todas como lidas
                </button>
              ) : null}
            </div>

            <div className="flex max-h-96 flex-col overflow-y-auto">
              {initialNotifications.length === 0 ? (
                <p className="px-4 py-8 text-center font-body text-body-sm text-on-surface-variant">Nenhuma notificação por aqui.</p>
              ) : (
                initialNotifications.map((notification) => {
                  const href = notificationTargetHref(notification);
                  const unread = notification.read_at === null;
                  const content = (
                    <>
                      <span className="flex items-start justify-between gap-2">
                        <span className="font-label text-label-sm text-on-surface">{notification.title}</span>
                        {unread ? <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" /> : null}
                      </span>
                      <span className="font-body text-body-sm text-on-surface-variant">{notification.message}</span>
                      <span className="font-body text-body-sm text-outline">{timeAgo(notification.created_at)}</span>
                    </>
                  );

                  const rowClassName = "flex flex-col gap-1 border-b border-outline-variant/10 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-surface-container-low";

                  if (!href) {
                    return (
                      <div className={rowClassName} key={notification.id}>
                        {content}
                      </div>
                    );
                  }

                  return (
                    <Link
                      className={rowClassName}
                      href={href}
                      key={notification.id}
                      onClick={() => {
                        setOpen(false);
                        if (unread) startTransition(() => markNotificationReadAction(notification.id));
                      }}
                    >
                      {content}
                    </Link>
                  );
                })
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
