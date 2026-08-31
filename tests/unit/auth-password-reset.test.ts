import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * D7 — corrige o fluxo de recuperação de senha (auditoria D6: o
 * `redirectTo` apontava para `/login`, sem nenhuma página que tratasse o
 * retorno do link e chamasse `updateUser`). Cobre:
 *  - `resetPasswordRequestAction` agora aponta para `/redefinir-senha`,
 *    e continua nunca revelando se um e-mail existe;
 *  - `updatePasswordAction` — a identidade vem SEMPRE da sessão do
 *    Supabase Auth (`auth.getUser()`), nunca de `user_id`/`tenant_id`
 *    injetado pelo `formData`; `updateUser` só é chamado com sessão
 *    válida; senha/tokens nunca aparecem em log.
 *
 * Mesmo padrão de mock de `tests/unit/melhorenvio-callback-route.test.ts`
 * (client Supabase e `getPublicEnv` mockados via `vi.mock`).
 */
vi.mock("@/lib/env", () => ({
  getPublicEnv: vi.fn(() => ({ NEXT_PUBLIC_SITE_URL: "https://vexoecommerce.vercel.app" })),
  getServerEnv: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceRoleClient: vi.fn(),
}));

import { getPublicEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resetPasswordRequestAction, updatePasswordAction } from "@/features/auth/actions";
import { initialResetPasswordRequestState, initialUpdatePasswordState } from "@/features/auth/schema";

const SYNTHETIC_USER = { id: "11111111-1111-1111-1111-111111111111", email: "lojista@example.com" };

function mockAuthClient(overrides: {
  user?: typeof SYNTHETIC_USER | null;
  updateUserError?: { message: string } | null;
  resetPasswordForEmailError?: { message: string } | null;
} = {}) {
  const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: overrides.resetPasswordForEmailError ?? null });
  const resolvedUser = "user" in overrides ? overrides.user : SYNTHETIC_USER;
  const getUser = vi.fn().mockResolvedValue({ data: { user: resolvedUser }, error: null });
  const updateUser = vi.fn().mockResolvedValue({ error: overrides.updateUserError ?? null });
  const signOut = vi.fn().mockResolvedValue({ error: null });

  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { resetPasswordForEmail, getUser, updateUser, signOut },
  } as never);

  return { resetPasswordForEmail, getUser, updateUser, signOut };
}

function formDataOf(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("resetPasswordRequestAction (D7)", () => {
  afterEach(() => {
    vi.mocked(createSupabaseServerClient).mockReset();
    vi.mocked(getPublicEnv).mockClear();
  });

  it("1. redirectTo aponta para /redefinir-senha (nunca mais /login)", async () => {
    const { resetPasswordForEmail } = mockAuthClient();

    await resetPasswordRequestAction(initialResetPasswordRequestState, formDataOf({ email: "lojista@example.com" }));

    expect(resetPasswordForEmail).toHaveBeenCalledWith(
      "lojista@example.com",
      expect.objectContaining({ redirectTo: "https://vexoecommerce.vercel.app/redefinir-senha" }),
    );
  });

  it("2. e-mail inexistente/erro do Supabase nunca é revelado — resposta é sempre a mesma mensagem genérica de sucesso", async () => {
    mockAuthClient({ resetPasswordForEmailError: { message: "User not found" } });

    const result = await resetPasswordRequestAction(initialResetPasswordRequestState, formDataOf({ email: "naoexiste@example.com" }));

    expect(result.status).toBe("success");
    expect(result.message).toMatch(/se este e-mail estiver cadastrado/i);
    expect(JSON.stringify(result)).not.toContain("User not found");
  });

  it("e-mail inválido é rejeitado antes de chamar o Supabase", async () => {
    const { resetPasswordForEmail } = mockAuthClient();

    const result = await resetPasswordRequestAction(initialResetPasswordRequestState, formDataOf({ email: "not-an-email" }));

    expect(result.status).toBe("error");
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe("updatePasswordAction (D7)", () => {
  afterEach(() => {
    vi.mocked(createSupabaseServerClient).mockReset();
  });

  it("8. senha válida e confirmação igual é aceita — atualiza e desloga a sessão de recovery", async () => {
    const { updateUser, signOut } = mockAuthClient();

    const result = await updatePasswordAction(
      initialUpdatePasswordState,
      formDataOf({ password: "novaSenha123", confirmPassword: "novaSenha123" }),
    );

    expect(updateUser).toHaveBeenCalledWith({ password: "novaSenha123" });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("success");
  });

  it("7. senha e confirmação diferentes são rejeitadas — updateUser nunca é chamado", async () => {
    const { updateUser } = mockAuthClient();

    const result = await updatePasswordAction(
      initialUpdatePasswordState,
      formDataOf({ password: "novaSenha123", confirmPassword: "outraSenha456" }),
    );

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.confirmPassword).toMatch(/não coincidem/i);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("senha curta (< 8 caracteres) é rejeitada — updateUser nunca é chamado", async () => {
    const { updateUser } = mockAuthClient();

    const result = await updatePasswordAction(initialUpdatePasswordState, formDataOf({ password: "abc12", confirmPassword: "abc12" }));

    expect(result.status).toBe("error");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("4/9. sem sessão de recovery válida (link expirado/inválido/já usado): updateUser nunca é chamado", async () => {
    const { updateUser, getUser } = mockAuthClient({ user: null });

    const result = await updatePasswordAction(
      initialUpdatePasswordState,
      formDataOf({ password: "novaSenha123", confirmPassword: "novaSenha123" }),
    );

    expect(getUser).toHaveBeenCalledTimes(1);
    expect(updateUser).not.toHaveBeenCalled();
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/expirou|utilizado/i);
  });

  it("5. user_id enviado pelo navegador é ignorado — updateUser é chamado só com a senha, identidade vem da sessão", async () => {
    const { updateUser } = mockAuthClient();

    await updatePasswordAction(
      initialUpdatePasswordState,
      formDataOf({ password: "novaSenha123", confirmPassword: "novaSenha123", userId: "99999999-9999-9999-9999-999999999999" }),
    );

    expect(updateUser).toHaveBeenCalledWith({ password: "novaSenha123" });
    expect(updateUser).not.toHaveBeenCalledWith(expect.objectContaining({ userId: expect.anything() }));
  });

  it("6. tenant_id enviado pelo navegador é ignorado — não influencia a chamada nem o resultado", async () => {
    const { updateUser } = mockAuthClient();

    const result = await updatePasswordAction(
      initialUpdatePasswordState,
      formDataOf({ password: "novaSenha123", confirmPassword: "novaSenha123", tenantId: "some-other-tenant" }),
    );

    expect(updateUser).toHaveBeenCalledWith({ password: "novaSenha123" });
    expect(result.status).toBe("success");
  });

  it("9. erro do Supabase em updateUser nunca vaza detalhe interno ao usuário", async () => {
    const { signOut } = mockAuthClient({ updateUserError: { message: "New password should be different from the old password." } });

    const result = await updatePasswordAction(
      initialUpdatePasswordState,
      formDataOf({ password: "novaSenha123", confirmPassword: "novaSenha123" }),
    );

    expect(result.status).toBe("error");
    expect(result.message).not.toContain("old password");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("10/11. senha e tokens nunca aparecem em nenhum log durante o fluxo (sucesso e erro)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockAuthClient();

    const secretPassword = "SenhaSecreta987";
    await updatePasswordAction(initialUpdatePasswordState, formDataOf({ password: secretPassword, confirmPassword: secretPassword }));

    const allLoggedText = JSON.stringify([...logSpy.mock.calls, ...errorSpy.mock.calls]);
    expect(allLoggedText).not.toContain(secretPassword);
    expect(allLoggedText).not.toMatch(/access_token|refresh_token/i);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
