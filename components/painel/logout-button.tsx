import { signOutAction } from "@/features/auth/sign-out-action";

/**
 * Um `<form action={serverAction}>` funciona direto num Server Component
 * — não precisa de `"use client"` nem de handler no browser para isto
 * (arquitetura §19: só Client Component onde existe interação real).
 */
export function LogoutButton({ variant }: { variant: "nav" | "settings" }) {
  if (variant === "settings") {
    return (
      <form action={signOutAction}>
        <button
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-error/30 px-4 py-2.5 font-label text-label-md text-error transition-colors hover:bg-error-container/10"
          type="submit"
        >
          <span className="material-symbols-outlined text-[18px]">logout</span>
          Sair da conta
        </button>
      </form>
    );
  }

  return (
    <form action={signOutAction}>
      <button
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 font-medium text-on-surface-variant transition-colors duration-200 hover:bg-surface-container-high hover:text-on-surface"
        type="submit"
      >
        <span className="material-symbols-outlined">logout</span>
        <span className="font-label text-label-md">Logout</span>
      </button>
    </form>
  );
}
