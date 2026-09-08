import { z } from "zod";

/**
 * D18.3 — as 5 chaves fixas do RBAC (roles.key, Etapa 2). Nunca papéis
 * customizados — o ticket é explícito: "NÃO criar custom roles". Usado
 * tanto no convite quanto na troca de papel; qual delas o ator pode de
 * fato aplicar é decidido pelo banco (has_permission + triggers de
 * 20260817220013/20260817220105), nunca filtrado só aqui.
 */
export const ROLE_KEYS = ["OWNER", "ADMIN", "MANAGER", "OPERATOR", "SUPPORT"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const inviteTeamMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  roleKey: z.enum(ROLE_KEYS, { message: "Selecione uma função" }),
});

export type InviteTeamMemberInput = z.infer<typeof inviteTeamMemberSchema>;

export interface TeamActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<keyof InviteTeamMemberInput, string>>;
}

export const initialTeamActionState: TeamActionState = { status: "idle" };

export const changeRoleSchema = z.object({
  roleKey: z.enum(ROLE_KEYS, { message: "Selecione uma função" }),
});
