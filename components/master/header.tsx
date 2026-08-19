export function MasterHeader({ userInitial, userName }: { userInitial: string; userName: string }) {
  return (
    <header className="fixed left-0 top-0 z-40 flex h-16 w-full items-center justify-between border-b border-outline-variant bg-surface/80 px-margin-mobile backdrop-blur-md md:left-[260px] md:w-[calc(100%-260px)] md:px-margin-desktop">
      <span className="font-headline text-headline-sm font-black tracking-tight text-tertiary md:hidden">
        VEXO MASTER
      </span>
      <div className="hidden flex-1 md:block" />
      <div
        className="flex h-8 w-8 items-center justify-center rounded-full border border-tertiary/40 bg-surface-container-high font-label text-label-md text-on-surface"
        title={userName}
      >
        {userInitial}
      </div>
    </header>
  );
}
