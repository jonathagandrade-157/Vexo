import { describe, expect, it } from "vitest";

import { friendlyTeamErrorMessage, resolveRoleLabel, resolveStatusLabel } from "@/features/team/messages";
import { ROLE_KEYS } from "@/features/team/schema";

describe("team-messages", () => {
  it("todo papel do RBAC fixo tem um label não vazio", () => {
    for (const role of ROLE_KEYS) {
      expect(resolveRoleLabel(role).length).toBeGreaterThan(0);
    }
  });

  it("resolveRoleLabel: chave desconhecida retorna a própria chave (nunca undefined)", () => {
    expect(resolveRoleLabel("SOMETHING_ELSE")).toBe("SOMETHING_ELSE");
  });

  it("resolveStatusLabel: os 3 status de tenant_members têm label", () => {
    expect(resolveStatusLabel("invited")).toBe("Convite pendente");
    expect(resolveStatusLabel("active")).toBe("Ativo");
    expect(resolveStatusLabel("removed")).toBe("Removido");
  });

  it("resolveStatusLabel: status desconhecido retorna o próprio valor", () => {
    expect(resolveStatusLabel("weird")).toBe("weird");
  });

  it("friendlyTeamErrorMessage: mapeia o erro de último OWNER do trigger prevent_removing_last_owner", () => {
    const msg = friendlyTeamErrorMessage("cannot remove or demote the last active OWNER of a tenant — assign another OWNER first");
    expect(msg).toMatch(/Dono\(a\)/);
  });

  it("friendlyTeamErrorMessage: mapeia o erro de concessão de OWNER do trigger prevent_unauthorized_owner_grant", () => {
    const msg = friendlyTeamErrorMessage("only an existing OWNER (or a platform admin) can grant the OWNER role");
    expect(msg).toMatch(/Dono\(a\)/);
  });

  it("friendlyTeamErrorMessage: mapeia o erro de auto-alteração do trigger prevent_self_role_change", () => {
    const msg = friendlyTeamErrorMessage("a member cannot change their own role");
    expect(msg).toBe("Você não pode alterar sua própria função.");
  });

  it("friendlyTeamErrorMessage: mensagem desconhecida/nula cai no fallback genérico, nunca expõe o erro bruto do Postgres", () => {
    expect(friendlyTeamErrorMessage(null)).toBe("Não foi possível concluir esta operação. Tente novamente.");
    expect(friendlyTeamErrorMessage("some raw postgres internal detail")).toBe("Não foi possível concluir esta operação. Tente novamente.");
  });

  it("nenhuma mensagem amigável expõe SQLSTATE, nome de trigger/função ou stack", () => {
    const samples = [
      friendlyTeamErrorMessage("cannot remove or demote the last active OWNER of a tenant — assign another OWNER first"),
      friendlyTeamErrorMessage("only an existing OWNER (or a platform admin) can grant the OWNER role"),
      friendlyTeamErrorMessage("a member cannot change their own role"),
      friendlyTeamErrorMessage("user_id is immutable — remove and re-invite instead"),
    ];
    for (const msg of samples) {
      expect(msg).not.toMatch(/23514|42501|prevent_|trigger|function|postgres/i);
    }
  });
});
