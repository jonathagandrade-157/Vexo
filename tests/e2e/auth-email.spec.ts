import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { localAuthAdmin, localAuthEmail, syntheticDocument } from "./local-auth-mail";

async function query(sql: string, values: unknown[]) {
  if (process.env.E2E_ISOLATED_SUPABASE !== "1" || !["127.0.0.1", "localhost"].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error("Auth mutations require a disposable loopback database.");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect(); try { return await client.query(sql, values); } finally { await client.end(); }
}
test.describe("e-mails Auth locais", () => {
  test.skip(process.env.E2E_ISOLATED_SUPABASE !== "1" || process.env.E2E_EMAIL_CONFIRMATION !== "1", "Requires isolated Auth and local Mailpit.");
  test("recupera senha por e-mail e rejeita link utilizado ou expirado", async ({ page }) => {
    const email = `recovery-${randomBytes(6).toString("hex")}@example.test`;
    const admin = localAuthAdmin();
    const password = "Synthetic-before-A9!"; const newPassword = "Synthetic-after-B8!";
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error).toBeNull();
    await page.goto("/recuperar-senha");
    await page.getByLabel("E-mail", { exact: true }).fill(email);
    await page.getByRole("button", { name: /enviar.*link/i }).click();
    const message = await localAuthEmail(email);
    await page.goto(message.link);
    await expect(page).toHaveURL(/\/redefinir-senha$/);
    await page.getByLabel("Nova senha", { exact: true }).fill(newPassword);
    await page.getByLabel("Confirme a nova senha", { exact: true }).fill(newPassword);
    await page.getByRole("button", { name: "Salvar nova senha", exact: true }).click();
    await expect(page.getByText("Senha atualizada com sucesso. Entre novamente com sua nova senha.")).toBeVisible();
    const check = localAuthAdmin();
    expect((await check.auth.signInWithPassword({ email, password })).error).not.toBeNull();
    expect((await check.auth.signInWithPassword({ email, password: newPassword })).error).toBeNull();
    await check.auth.signOut();
    await page.goto(message.link);
    await expect(page.getByText("Este link de redefinição é inválido ou já expirou.")).toBeVisible();
    const expired = await admin.auth.admin.generateLink({ type: "recovery", email });
    expect(expired.error).toBeNull();
    await query("update auth.users set recovery_sent_at=now()-interval '2 hours' where id=$1", [created.data.user!.id]);
    await page.goto(`/auth/confirm?type=recovery&token_hash=${expired.data.properties!.hashed_token}`);
    await expect(page.getByText("Este link de redefinição é inválido ou já expirou.")).toBeVisible();
    await expect(page.getByLabel("Nova senha", { exact: true })).toHaveCount(0);
  });

  test("finaliza conta confirmada em outro navegador sem confiar em metadados editáveis", async ({ page }) => {
    const nonce = randomBytes(6).toString("hex"); const email = `resume-${nonce}@example.test`;
    const generated = await localAuthAdmin().auth.admin.generateLink({ type: "signup", email, password: "Synthetic-resume-A9!" });
    expect(generated.error).toBeNull();
    await page.goto(`/auth/confirm?type=signup&token_hash=${generated.data.properties!.hashed_token}`);
    await expect(page.getByRole("heading", { name: "Conclua o cadastro da sua loja" })).toBeVisible();
    await expect(page.getByLabel("Senha", { exact: true })).toHaveCount(0);
    await page.getByLabel("Nome da loja", { exact: true }).fill(`Retomada ${nonce}`);
    await page.getByLabel("Nome completo", { exact: true }).fill("Conta sintética retomada");
    await page.getByLabel("Telefone", { exact: true }).fill("11999999999");
    await page.getByLabel("CPF / CNPJ", { exact: true }).fill(syntheticDocument(randomBytes(9)));
    await page.locator('input[name="acceptTerms"]').check();
    await page.getByRole("button", { name: "Concluir cadastro", exact: true }).click();
    await expect(page).toHaveURL(/\/trial\/sucesso\?tenant=/);
    const count = await query("select count(*)::int as total from public.tenants t join auth.users u on t.created_by=u.id where u.email=$1", [email]);
    expect(count.rows[0].total).toBe(1);
    await page.goto("/cadastro");
    await expect(page).toHaveURL(/\/onboarding\/segmento$/);
  });
});
