import type { Metadata } from "next";

import { countMasters, listPlatformAdmins } from "@/features/master/admins-data";

export const metadata: Metadata = { title: "Administradores — VEXO Master" };

const ROLE_LABELS: Record<string, string> = { MASTER: "MASTER", SUPPORT_AGENT: "Suporte" };
const ROLE_STYLES: Record<string, string> = {
  MASTER: "bg-tertiary-container/20 text-tertiary",
  SUPPORT_AGENT: "bg-surface-container-highest text-on-surface-variant",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

/**
 * D11.3 — `/master/administradores`, somente leitura de `platform_admins`
 * (Etapa 2). Nenhuma ação de adicionar/alterar papel/remover existe nesta
 * tela — a própria migration de origem revoga escrita nessa tabela de
 * TODO papel de aplicação, inclusive `service_role` (ver comentário em
 * `features/master/admins-data.ts` e a seção K do relatório final D11.3).
 * MASTER e SUPPORT_AGENT veem exatamente a mesma listagem — RLS já libera
 * `is_platform_admin()` para ambos, sem distinção nesta tela (não há
 * nenhuma ação que precisasse ser restrita só a MASTER).
 */
export default async function MasterAdministradoresPage() {
  const admins = await listPlatformAdmins();
  const masterCount = countMasters(admins);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-headline text-headline-md text-on-surface">Administradores</h1>
        <p className="mt-1 font-body text-body-md text-on-surface-variant">
          Usuários com acesso administrativo à plataforma VEXO (papéis MASTER e Suporte) — {admins.length} no total,{" "}
          {masterCount} MASTER.
        </p>
      </div>

      <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
        <p className="font-body text-body-sm text-on-surface-variant">
          Por decisão de segurança da plataforma (Etapa 2), a gestão de administradores — adicionar, remover ou
          alterar o papel de alguém — não é feita por nenhuma tela do sistema, nem pelo código do próprio VEXO: é
          feita fora do fluxo normal da aplicação, diretamente no banco de dados. Esta página é só de consulta.
        </p>
      </div>

      {admins.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-surface-container-highest bg-[#121212] px-6 py-20 text-center">
          <span className="material-symbols-outlined text-3xl text-on-surface-variant opacity-60">
            admin_panel_settings
          </span>
          <p className="font-body text-body-md text-on-surface-variant">Nenhum administrador encontrado.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-surface-container-highest bg-[#121212]">
          <div className="hidden grid-cols-12 gap-4 border-b border-surface-container-highest bg-surface-container-low/50 px-6 py-4 sm:grid">
            <div className="col-span-5 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Administrador</div>
            <div className="col-span-4 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">E-mail</div>
            <div className="col-span-1 text-center font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Papel</div>
            <div className="col-span-2 text-right font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Desde</div>
          </div>
          <div className="divide-y divide-surface-container-highest/50">
            {admins.map((admin) => (
              <div className="grid grid-cols-12 items-center gap-4 px-6 py-4" key={admin.id}>
                <div className="col-span-12 sm:col-span-5">
                  <div className="font-body text-body-md font-medium text-on-surface">{admin.fullName ?? "—"}</div>
                  <div className="font-body text-body-sm text-on-surface-variant">{admin.userId}</div>
                </div>
                <div className="col-span-6 sm:col-span-4 font-body text-body-sm text-on-surface-variant">
                  {admin.email ?? "—"}
                </div>
                <div className="col-span-3 sm:col-span-1 flex justify-center">
                  <span
                    className={`rounded-full px-2 py-1 font-label text-label-sm uppercase ${ROLE_STYLES[admin.role] ?? "bg-surface-container-highest text-on-surface-variant"}`}
                  >
                    {ROLE_LABELS[admin.role] ?? admin.role}
                  </span>
                </div>
                <div className="col-span-3 sm:col-span-2 text-right font-body text-body-sm text-on-surface-variant">
                  {formatDate(admin.createdAt)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
