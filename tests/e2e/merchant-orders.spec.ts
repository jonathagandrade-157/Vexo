import { expect, test } from "@playwright/test";
import { actionRequest, addBuyerProduct, fillCheckout, login, query, replayAction, seedBuyerProduct, visual, watchErrors } from "./local-commerce";
import type { Page } from "@playwright/test";

async function createOrder(page: Page) {
  const item=await seedBuyerProduct(3);
  await addBuyerProduct(page,item.productSlug);
  const email=await fillCheckout(page);
  await page.getByRole("button",{name:"Continuar no WhatsApp",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Pedido criado com sucesso!"})).toBeVisible();
  return {...item,email,orderId:new URL(page.url()).pathname.split("/").at(-1)!};
}
test.describe("pedidos completos no painel isolado",()=>{
  test.skip(process.env.E2E_ISOLATED_SUPABASE!=="1","Only disposable loopback services.");
  test("filtra pedido, rejeita salto de status e completa o ciclo com histórico",async({page},info)=>{
    test.setTimeout(180000);
    const errors=watchErrors(page); const order=await createOrder(page);
    await login(page); await page.goto("/painel/pedidos");
    await page.getByLabel("Buscar",{exact:true}).fill(order.email);
    await page.getByLabel("Status",{exact:true}).selectOption("PENDING");
    await page.getByLabel("Origem",{exact:true}).selectOption("whatsapp");
    await page.getByLabel("Pagamento",{exact:true}).selectOption("cash");
    for(const period of ["today","7d","30d"]) {
      await page.getByLabel("Período",{exact:true}).selectOption(period);
      await page.getByRole("button",{name:"Filtrar",exact:true}).click();
      await expect(page.locator('a[href="/painel/pedidos/'+order.orderId+'"]:visible').first()).toBeVisible();
      expect(new URL(page.url()).searchParams.get("period")).toBe(period);
    }
    await page.getByRole("link",{name:"Cancelados",exact:true}).click();
    await expect(page.getByText("Nenhum pedido corresponde à busca/filtro atual.",{exact:true})).toBeVisible();
    await page.getByRole("link",{name:"Todos",exact:true}).click();
    await page.locator('a[href="/painel/pedidos/'+order.orderId+'"]:visible').first().click();
    // Bypass the cosmetic options: the server must still reject the jump.
    await page.getByLabel("Novo status",{exact:true}).evaluate((select: HTMLSelectElement)=>{
      const option=document.createElement("option");option.value="DELIVERED";option.text="Tentativa inválida";select.append(option);
    });
    await page.getByLabel("Novo status",{exact:true}).selectOption("DELIVERED");
    await page.getByRole("button",{name:"Avançar status",exact:true}).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText("Essa transição de status não é permitida a partir do status atual.");
    expect((await query("select status from public.orders where id=$1",[order.orderId])).rows[0].status).toBe("PENDING");
    await page.getByRole("button",{name:"Confirmar pagamento",exact:true}).click();
    const dialog=page.getByRole("dialog");
    await dialog.getByLabel("Motivo/observação",{exact:true}).fill("Confirmação sintética sem recebimento financeiro.");
    await dialog.getByRole("button",{name:"Confirmar pagamento",exact:true}).click();
    await expect(page.getByText("Pagamento confirmado.",{exact:true})).toBeVisible();
    for(const status of ["PREPARING","SHIPPED","DELIVERED"]) {
      await page.getByLabel("Novo status",{exact:true}).selectOption(status);
      await page.getByLabel("Nota interna (opcional)",{exact:true}).fill("Etapa sintética "+status);
      await page.getByRole("button",{name:"Avançar status",exact:true}).click();
      await expect.poll(async()=>(await query("select status from public.orders where id=$1",[order.orderId])).rows[0].status).toBe(status);
      await page.reload();
    }
    await expect(page.getByText("Este pedido está em um status final — nenhuma transição disponível.",{exact:true})).toBeVisible();
    await expect(page.getByRole("button",{name:"Avançar status",exact:true})).toHaveCount(0);
    await expect(page.getByText("Nota: Etapa sintética DELIVERED",{exact:true})).toBeVisible();
    expect((await query("select count(*)::int as total from public.audit_logs where resource_id=$1 and action='ORDER_STATUS_CHANGED'",[order.orderId])).rows[0].total).toBe(4);
    expect((await query("select stock_quantity from public.product_inventory where product_id=$1",[order.productId])).rows[0].stock_quantity).toBe(2);
    await visual(page,info,"pedido-entregue-historico");
    expect(errors).toEqual([]);
  });
  test("cancelamento repõe estoque uma vez, inclusive com replay",async({page},info)=>{
    const errors=watchErrors(page); const order=await createOrder(page);
    expect((await query("select stock_quantity from public.product_inventory where product_id=$1",[order.productId])).rows[0].stock_quantity).toBe(2);
    await login(page); await page.goto("/painel/pedidos/"+order.orderId);
    await page.getByLabel("Novo status",{exact:true}).selectOption("CANCELLED");
    await page.getByLabel("Nota interna (opcional)",{exact:true}).fill("Cancelamento sintético.");
    const captured=actionRequest(page);
    await page.getByRole("button",{name:"Avançar status",exact:true}).click();
    const request=await captured;
    await expect.poll(async()=>(await query("select status from public.orders where id=$1",[order.orderId])).rows[0].status).toBe("CANCELLED");
    await page.reload();
    await expect(page.getByText("Este pedido está em um status final — nenhuma transição disponível.",{exact:true})).toBeVisible();
    expect((await query("select stock_quantity from public.product_inventory where product_id=$1",[order.productId])).rows[0].stock_quantity).toBe(3);
    const response=await replayAction(page,request);
    expect(response.status()).toBeLessThan(500);
    expect(await response.text()).toContain("transição");
    expect((await query("select stock_quantity from public.product_inventory where product_id=$1",[order.productId])).rows[0].stock_quantity).toBe(3);
    expect((await query("select count(*)::int as total from public.audit_logs where resource_id=$1 and action='ORDER_STATUS_CHANGED'",[order.orderId])).rows[0].total).toBe(1);
    await visual(page,info,"pedido-cancelado");
    expect(errors).toEqual([]);
  });
});
