import type { RoleKey } from "./schema";

/**
 * D18.3 — mapeamento de texto puro, mesmo princípio de
 * `features/settings/domain-verification-messages.ts`/`domain-vercel-messages.ts`:
 * extraído dos componentes para ser testável sem DOM (`vitest`, `environment:
 * "node"`, sem jsdom).
 */

const ROLE_LABELS: Record<RoleKey, string> = {
  OWNER: "Dono(a)",
  ADMIN: "Administrador(a)",
  MANAGER: "Gerente",
  OPERATOR: "Operador(a)",
  SUPPORT: "Suporte",
};

export function resolveRoleLabel(roleKey: string): string {
  return ROLE_LABELS[roleKey as RoleKey] ?? roleKey;
}

export type TeamMemberStatus = "invited" | "active" | "removed";

const STATUS_LABELS: Record<TeamMemberStatus, string> = {
  invited: "Convite pendente",
  active: "Ativo",
  removed: "Removido",
};

export function resolveStatusLabel(status: string): string {
  return STATUS_LABELS[status as TeamMemberStatus] ?? status;
}

/**
 * Traduz os erros que os triggers de banco (20260817220013/20260817220105)
 * lançam para o usuário final — nunca a mensagem técnica bruta do Postgres
 * (mesmo princípio já usado em `domain-vercel-actions.ts::mapErrorCodeToMessage`).
 * Casada em `error.message`, não em `error.code` (várias dessas exceções
 * dividem o mesmo código SQLSTATE — 23514/42501 — entre triggers
 * diferentes, então o texto é a única forma de distinguir qual delas
 * disparou).
 */
export function friendlyTeamErrorMessage(rawMessage: string | null | undefined): string {
  const msg = rawMessage ?? "";
  if (msg.includes("cannot remove or demote the last active OWNER")) {
    return "Esta é a única pessoa com o papel de Dono(a) da loja. Promova outra pessoa a Dono(a) antes de remover ou alterar esta função.";
  }
  if (msg.includes("only an existing OWNER") || msg.includes("founding member of a brand-new tenant")) {
    return "Só quem já é Dono(a) da loja pode conceder o papel de Dono(a) a outra pessoa.";
  }
  if (msg.includes("cannot change their own role")) {
    return "Você não pode alterar sua própria função.";
  }
  if (msg.includes("user_id is immutable")) {
    return "Não foi possível concluir esta operação. Tente novamente.";
  }
  return "Não foi possível concluir esta operação. Tente novamente.";
}
