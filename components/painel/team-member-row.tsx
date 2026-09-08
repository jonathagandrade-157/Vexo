"use client";

import { useState, useTransition } from "react";

import { changeTeamMemberRoleAction, removeTeamMemberAction, type TeamMemberRow as TeamMemberRowData } from "@/features/team/actions";
import { resolveRoleLabel, resolveStatusLabel } from "@/features/team/messages";
import { ROLE_KEYS } from "@/features/team/schema";

const STATUS_STYLES: Record<string, string> = {
  invited: "bg-amber-500/10 text-amber-400",
  active: "bg-emerald-500/10 text-emerald-400",
};

/**
 * D18.3 — uma linha da lista de equipe. `isSelf`/`viewerIsOwner` só
 * decidem o que MOSTRAR (nunca escondem uma ação que o servidor deixaria
 * passar por engano, é o oposto: escondem ações que a RLS/triggers de
 * 20260817220013/20260817220105 SEMPRE rejeitariam — ninguém muda o
 * próprio papel, remover/rebaixar um OWNER exige ser OWNER) — evita
 * mostrar um controle que só resultaria num erro genérico "membro não
 * encontrado" (a RLS filtra a linha antes do trigger dar um erro mais
 * específico). A autorização real continua inteiramente no servidor.
 */
export function TeamMemberRow({
  member,
  canManage,
  viewerIsOwner,
}: {
  member: TeamMemberRowData;
  canManage: boolean;
  viewerIsOwner: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const isOwnerRow = member.roleKey === "OWNER";
  const canEditThisRow = canManage && !member.isSelf && (!isOwnerRow || viewerIsOwner);

  function handleRoleChange(nextRole: string) {
    setError(null);
    startTransition(async () => {
      const result = await changeTeamMemberRoleAction(member.id, nextRole);
      if (result.status === "error") {
        setError(result.message ?? "Não foi possível atualizar a função.");
      }
    });
  }

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      const result = await removeTeamMemberAction(member.id);
      if (result.status === "error") {
        setError(result.message ?? "Não foi possível remover este membro.");
      }
      setConfirmingRemove(false);
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="font-label text-label-md text-on-surface">
            {member.fullName || member.email || "—"}
            {member.isSelf ? <span className="ml-1.5 text-on-surface-variant">(você)</span> : null}
          </span>
          {member.fullName ? <span className="font-body text-body-sm text-on-surface-variant">{member.email}</span> : null}
        </div>

        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center rounded-full px-2 py-1 font-label text-label-sm uppercase ${STATUS_STYLES[member.status] ?? ""}`}>
            {resolveStatusLabel(member.status)}
          </span>

          {canEditThisRow ? (
            <select
              className="input-focus-glow rounded-lg border border-surface-container-highest bg-surface-container-lowest px-2 py-1.5 font-body text-body-sm text-on-surface focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              defaultValue={member.roleKey}
              disabled={isPending}
              onChange={(e) => handleRoleChange(e.target.value)}
            >
              {ROLE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {resolveRoleLabel(key)}
                </option>
              ))}
            </select>
          ) : (
            <span className="font-body text-body-sm text-on-surface-variant">{resolveRoleLabel(member.roleKey)}</span>
          )}

          {canEditThisRow ? (
            confirmingRemove ? (
              <div className="flex items-center gap-2">
                <button
                  className="font-label text-label-sm text-error transition-colors hover:text-error/80 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isPending}
                  onClick={handleRemove}
                  type="button"
                >
                  Confirmar
                </button>
                <button
                  className="font-label text-label-sm text-on-surface-variant transition-colors hover:text-on-surface"
                  disabled={isPending}
                  onClick={() => setConfirmingRemove(false)}
                  type="button"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                aria-label="Remover membro"
                className="text-on-surface-variant transition-colors hover:text-error disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isPending}
                onClick={() => setConfirmingRemove(true)}
                type="button"
              >
                <span className="material-symbols-outlined text-[20px]">delete</span>
              </button>
            )
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-error/30 bg-error-container/10 px-3 py-2 font-body text-body-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}
