import { expect, test } from "@playwright/test";
import { localAuthEmail } from "./local-auth-mail";
import { actionRequest, login, newProduct, query, replayAction, tenantId, watchErrors } from "./local-commerce";

const matrix = [
  { role: "OWNER", product: true, settings: true, orders: true, team: true, payments: true },
  { role: "ADMIN", product: true, settings: true, orders: true, team: true, payments: true },
  { role: "MANAGER", product: true, settings: false, orders: true, team: false, payments: false },
  { role: "OPERATOR", product: false, settings: false, orders: true, team: false, payments: false },
  { role: "SUPPORT", product: false, settings: false, orders: false, team: false, payments: false },
] as const;
test.describe("matriz real de permissões da equipe", () => {
  test.skip(process.env.E2E_ISOLATED_SUPABASE !== "1", "Only disposable loopback services.");
  for (const entry of matrix) {
    test(entry.role + ": rotas, controles e ação do servidor", async ({ page }) => {
      const errors=watchErrors(page); const emails=JSON.parse(process.env.E2E_ROLE_EMAILS!) as Record<string,string>;
      await login(page); const productId=await newProduct(page);
      await page.getByLabel("Preço de venda",{exact:true}).fill("96");
      const captured=actionRequest(page);
      await page.getByRole("button",{name:"Salvar alterações",exact:true}).click();
      const request=await captured;
      await expect(page).toHaveURL(/\/painel\/produtos$/);
      await query("update public.products set price=95 where id=$1",[productId]);
      await page.context().clearCookies();
      await login(page,emails[entry.role]);
      await page.goto("/painel/produtos/"+productId+"/editar");
      if(entry.product) await expect(page.getByLabel("Nome do produto",{exact:true})).toBeVisible();
      else await expect(page.getByLabel("Nome do produto",{exact:true})).toHaveCount(0);
      const replay=await replayAction(page,request);
      expect(replay.status()).toBeLessThan(500);
      expect((await query("select price from public.products where id=$1",[productId])).rows[0].price).toBe(entry.product?"96.00":"95.00");
      if(!entry.product) expect(await replay.text()).toContain("permiss");
      await page.goto("/painel/pedidos");
      if(entry.orders) await expect(page.getByLabel("Buscar",{exact:true})).toBeVisible();
      else {
        await expect(page.getByText("Sua função não tem acesso à visualização de pedidos.",{exact:true})).toBeVisible();
        await expect(page.getByLabel("Buscar",{exact:true})).toHaveCount(0);
      }
      await page.goto("/painel/equipe");
      if(entry.team) await expect(page.getByRole("button",{name:/enviar convite/i})).toBeVisible();
      else {
        await expect(page.getByText("Sua função não tem acesso a esta página.",{exact:true})).toBeVisible();
        await expect(page.getByRole("button",{name:/enviar convite/i})).toHaveCount(0);
      }
      await page.goto("/painel/configuracoes/pagamentos");
      const connect=page.getByRole("button",{name:"Conectar Mercado Pago",exact:true});
      if(entry.payments) await expect(connect).toBeEnabled();
      else if(entry.role==="MANAGER") await expect(connect).toBeDisabled();
      else await expect(connect).toHaveCount(0);
      await page.goto("/painel/aparencia");
      const color=page.getByLabel("Cor primária",{exact:true});
      if(entry.settings) await expect(color).toBeEnabled(); else await expect(color).toBeDisabled();
      const identity=page.locator("section").filter({has:page.getByRole("heading",{name:"Identidade visual",exact:true})});
      await expect(identity.locator('input[type="file"]')).toHaveCount(entry.settings?1:0);
      expect(errors).toEqual([]);
    });
  }
  test("convite só usa Mailpit, aceita função, muda e remove membro sintético",async({page,browser})=>{
    const errors=watchErrors(page); await login(page); await page.goto("/painel/equipe");
    const email="invited-"+Date.now()+"-"+Math.random().toString(16).slice(2)+"@example.test";
    await page.getByLabel("E-mail",{exact:true}).fill(email);
    await page.getByLabel("Função",{exact:true}).selectOption("OPERATOR");
    await page.getByRole("button",{name:/enviar convite/i}).click();
    const outcome=page.getByText("Convite enviado com sucesso.",{exact:true});
    const inviteError=page.locator("main").getByRole("alert");
    await expect(outcome.or(inviteError)).toBeVisible();
    if(!await outcome.isVisible()) console.log("VEXO_INVITE_FAILURE:"+JSON.stringify({message:await inviteError.innerText(),grants:(await query("select has_table_privilege('service_role','public.tenant_members','INSERT') as service_insert,has_table_privilege('authenticated','public.tenant_members','INSERT') as session_insert")).rows}));
    await expect(outcome).toBeVisible();
    const message=await localAuthEmail(email);
    const invitedContext=await browser.newContext({baseURL:"http://127.0.0.1:3100"});
    const invitedPage=await invitedContext.newPage();
    await invitedPage.goto(message.link);
    await expect(invitedPage.getByLabel("Nova senha",{exact:true})).toBeVisible();
    // Tokens do convite nunca permanecem na URL (histórico/Referer/capturas).
    expect(new URL(invitedPage.url()).hash).toBe("");
    await invitedPage.getByLabel("Nova senha",{exact:true}).fill(process.env.E2E_OWNER_PASSWORD!);
    await invitedPage.getByLabel("Confirme a nova senha",{exact:true}).fill(process.env.E2E_OWNER_PASSWORD!);
    await invitedPage.getByRole("button",{name:"Salvar nova senha",exact:true}).click();
    await expect(invitedPage.getByText("Senha atualizada com sucesso. Entre novamente com sua nova senha.")).toBeVisible();
    await login(invitedPage,email);
    const member=page.getByRole("listitem").filter({hasText:email});
    await expect(member).toBeVisible(); await page.reload();
    const tid=await tenantId();
    expect((await query("select tm.status,r.key from public.tenant_members tm join public.roles r on r.id=tm.role_id join auth.users u on u.id=tm.user_id where tm.tenant_id=$1 and u.email=$2",[tid,email])).rows[0]).toEqual({status:"active",key:"OPERATOR"});
    await member.getByRole("combobox").selectOption("MANAGER");
    await expect.poll(async()=>(await query("select r.key from public.tenant_members tm join public.roles r on r.id=tm.role_id join auth.users u on u.id=tm.user_id where tm.tenant_id=$1 and u.email=$2",[tid,email])).rows[0].key).toBe("MANAGER");
    await page.reload();
    await member.getByRole("button",{name:"Remover membro",exact:true}).click();
    await member.getByRole("button",{name:"Confirmar",exact:true}).click();
    await expect(member).toHaveCount(0);
    expect((await query("select count(*)::int as total from public.tenant_members tm join auth.users u on u.id=tm.user_id where tm.tenant_id=$1 and u.email=$2",[tid,email])).rows[0].total).toBe(0);
    await invitedPage.goto("/painel/pedidos");
    await expect(invitedPage).toHaveURL(/\/sem-loja$/);
    await invitedContext.close();
    expect(errors).toEqual([]);
  });
});
