"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { TextField } from "@/components/ui/text-field";
import { inviteTeamMemberAction } from "@/features/team/actions";
import { resolveRoleLabel } from "@/features/team/messages";
import { ROLE_KEYS } from "@/features/team/schema";
import { initialTeamActionState } from "@/features/team/schema";

function InviteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className="rounded-lg bg-primary-container px-5 py-2.5 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? "Enviando…" : "Enviar convite"}
    </button>
  );
}

/**
 * D18.3 — convite por e-mail (`supabase.auth.admin.inviteUserByEmail`,
 * decisão registrada no relatório D18.3). Só renderizado pela página
 * quando `canManage` (`team.manage`) já foi confirmado no servidor — este
 * formulário nunca é a autorização em si.
 */
export function TeamInviteForm() {
  const [state, formAction] = useActionState(inviteTeamMemberAction, initialTeamActionState);

  return (
    <div className="flex flex-col gap-5 rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
      <div>
        <h2 className="font-headline text-headline-sm text-on-surface">Convidar funcionário</h2>
        <p className="mt-1 font-body text-body-sm text-on-surface-variant">
          A pessoa recebe um e-mail para criar a senha e acessar o painel da sua loja.
        </p>
      </div>

      <form action={formAction} className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <TextField
            autoComplete="email"
            error={state.fieldErrors?.email}
            icon="mail"
            id="email"
            label="E-mail"
            name="email"
            placeholder="funcionario@email.com"
            type="email"
          />
        </div>

        <div className="sm:w-52">
          <label className="mb-1.5 block font-label text-label-md uppercase text-on-surface-variant" htmlFor="roleKey">
            Função
          </label>
          <select
            className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest px-3 py-2.5 font-body text-body-sm text-on-surface focus:outline-none"
            defaultValue="OPERATOR"
            id="roleKey"
            name="roleKey"
          >
            {ROLE_KEYS.filter((key) => key !== "OWNER").map((key) => (
              <option key={key} value={key}>
                {resolveRoleLabel(key)}
              </option>
            ))}
          </select>
        </div>

        <InviteButton />
      </form>

      {state.status === "error" && state.message ? (
        <p className="rounded-lg border border-error/30 bg-error-container/10 px-3 py-2 font-body text-body-sm text-error" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.status === "success" ? <p className="font-body text-body-sm text-emerald-400">{state.message}</p> : null}
    </div>
  );
}
