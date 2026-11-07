import { expect, test } from "@playwright/test";
import { actionRequest, addBuyerProduct, fillCheckout, lockCheckoutCarts, login, otherSlug, query, replayAction, seedBuyerProduct, slug, unique, visual, watchErrors } from "./local-commerce";

test.describe("carrinho após adicionar produto", () => {
  test.skip(process.env.E2E_ISOLATED_SUPABASE !== "1", "Only disposable loopback services.");
  for (const audience of ["visitante", "lojista autenticado"] as const) {
    test("mantém o item no carrinho do " + audience + " após navegação e reload", async ({ page }, info) => {
      const errors = watchErrors(page);
      if (audience === "lojista autenticado") await login(page);
      await page.goto("/loja/" + slug + "/produto/principal");
      await page.getByRole("button", { name: /adicionar ao carrinho/i }).click();
      await expect(page.getByRole("status").filter({ hasText: /adicionado ao carrinho/i })).toBeVisible();
      const cookie = (await page.context().cookies()).find(value => value.name === "vexo_cart_" + slug);
      expect(cookie?.httpOnly).toBe(true); expect(cookie?.sameSite).toBe("Lax");
      const cartId = cookie!.value.split(".")[1]!;
      const persisted = await query("select ci.quantity,p.name from public.cart_items ci join public.products p on p.id=ci.product_id where ci.cart_id=$1", [cartId]);
      expect(persisted.rows).toEqual([{ quantity: 1, name: "Produto E2E principal" }]);
      await page.locator('header a[href="/loja/' + slug + '/carrinho"]').click();
      await expect(page).toHaveURL("/loja/"+slug+"/carrinho");
      await expect(page.getByRole("heading",{name:"Seu carrinho",exact:true})).toBeVisible();
      await expect(page.getByText("Produto E2E principal", { exact: true })).toBeVisible();
      await expect(page.getByText(/R\$\s*100,00/).first()).toBeVisible();
      await page.reload();
      await expect(page.getByText("Produto E2E principal", { exact: true })).toBeVisible();
      const updateResponse=page.waitForResponse(response=>response.request().method()==="POST" && new URL(response.url()).pathname==="/loja/"+slug+"/carrinho",{timeout:15000});
      await page.getByRole("button", { name: "Aumentar quantidade", exact: true }).click();
      const submitted=await updateResponse;
      console.log("VEXO_CART_UPDATE:"+JSON.stringify({status:submitted.status(),rows:(await query("select quantity from public.cart_items where cart_id=$1",[cartId])).rows}));

      await expect(page.getByText(/R\$\s*200,00/).first()).toBeVisible();
      await page.reload();
      expect((await query("select quantity from public.cart_items where cart_id=$1", [cartId])).rows).toEqual([{ quantity: 2 }]);
      await visual(page, info, "carrinho-" + (audience === "visitante" ? "visitante" : "autenticado"));
      expect(errors).toEqual([]);
    });
  }
});

test.describe("checkout e estoque isolados", () => {
  test.skip(process.env.E2E_ISOLATED_SUPABASE !== "1", "Only disposable loopback services.");
  test("mantém variante, promoção, quantidade e snapshot até pedido e confirmação", async ({ page, browser }, info) => {
    const errors = watchErrors(page); const item = await seedBuyerProduct(5, true);
    await addBuyerProduct(page, item.productSlug, true);
    await page.goto("/loja/" + slug + "/carrinho");
    await page.getByRole("button", { name: "Aumentar quantidade", exact: true }).click();
    await expect(page.getByText(/R\$\s*180,00/).first()).toBeVisible();
    await page.reload();
    await expect(page.getByText("Preto", { exact: true })).toBeVisible();
    await expect(page.getByText(/R\$\s*180,00/).first()).toBeVisible();
    const email = await fillCheckout(page);
    await page.getByRole("button", { name: "Continuar no WhatsApp", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Pedido criado com sucesso!" })).toBeVisible();
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    const snapshot = (await query("select o.total,oi.quantity,oi.unit_price,oi.variant_id,oi.variant_label from public.orders o join public.order_items oi on oi.order_id=o.id where o.id=$1",[id])).rows[0];
    expect(snapshot).toMatchObject({ total: "180.00", quantity: 2, unit_price: "90.00", variant_id: item.variantId, variant_label: "Preto" });
    expect((await query("select stock_quantity from public.product_inventory where product_id=$1",[item.productId])).rows[0].stock_quantity).toBe(3);
    await query("update public.product_variants set price=200,promotional_price=null where id=$1",[item.variantId]);
    await page.reload(); await expect(page.getByText(/R\$\s*180,00/).first()).toBeVisible();
    await visual(page, info, "pedido-variante");
    const stranger = await browser.newContext({ baseURL: "http://127.0.0.1:3100" });
    try {
      const other = await stranger.newPage();
      await other.goto("/loja/"+slug+"/pedido/"+id);
      await expect(other.getByRole("heading",{name:"Pedido não encontrado",exact:true})).toBeVisible();
      await expect(other.getByText(item.name,{exact:true})).toHaveCount(0);
      expect(await other.locator("body").innerText()).not.toContain(email);
      const cookie=(await page.context().cookies()).find(value=>value.name==="vexo_cart_"+slug)!;
      await stranger.addCookies([{...cookie,name:"vexo_cart_"+otherSlug,path:"/loja/"+otherSlug}]);
      await other.goto("/loja/"+otherSlug+"/pedido/"+id);
      await expect(other.getByRole("heading",{name:"Pedido não encontrado",exact:true})).toBeVisible();
    } finally { await stranger.close(); }
    expect(errors).toEqual([]);
  });
  test("recalcula preço alterado antes do checkout e rejeita indisponibilidade posterior", async ({ page }) => {
    const errors = watchErrors(page); const item = await seedBuyerProduct(3, true);
    await addBuyerProduct(page, item.productSlug, true);
    await query("update public.product_variants set promotional_price=75 where id=$1",[item.variantId]);
    await page.goto("/loja/"+slug+"/carrinho");
    await expect(page.getByText(/R\$\s*75,00/).first()).toBeVisible();
    await fillCheckout(page);
    await query("update public.product_variants set is_active=false where id=$1",[item.variantId]);
    await page.getByRole("button",{name:"Continuar no WhatsApp",exact:true}).click();
    await expect(page.locator("form").getByRole("alert").first()).toBeVisible();
    expect((await query("select count(*)::int as total from public.order_items where product_id=$1",[item.productId])).rows[0].total).toBe(0);
    expect((await query("select stock_quantity from public.product_inventory where product_id=$1",[item.productId])).rows[0].stock_quantity).toBe(3);
    expect(errors).toEqual([]);
  });
  test("última unidade concorrida cria um pedido sem estoque negativo", async ({ page, browser }, info) => {
    const item=await seedBuyerProduct(1);
    const second=await browser.newContext({baseURL:"http://127.0.0.1:3100"}); const other=await second.newPage();
    const errors=[watchErrors(page),watchErrors(other)];
    try {
      await Promise.all([addBuyerProduct(page,item.productSlug),addBuyerProduct(other,item.productSlug)]);
      await Promise.all([fillCheckout(page),fillCheckout(other)]);
      const carts=await Promise.all([page,other].map(async p=>(await p.context().cookies()).find(c=>c.name==="vexo_cart_"+slug)!.value.split(".")[1]!));
      const lock=await lockCheckoutCarts(carts);
      const submits=[page,other].map(p=>p.getByRole("button",{name:"Continuar no WhatsApp",exact:true}).click());
      try {
        // Both requests must actually wait on the controlled DB lock.
        await expect.poll(async()=>Number((await query("select count(*)::int as total from pg_stat_activity where $1=any(pg_blocking_pids(pid))",[lock.pid])).rows[0].total),{timeout:20000}).toBeGreaterThanOrEqual(2);
      } finally { await lock.release(); }
      await Promise.all(submits);
      await expect.poll(async()=>(await query("select count(*)::int as total from public.order_items where product_id=$1",[item.productId])).rows[0].total).toBe(1);
      const winner=[page,other].find(p=>p.url().includes("/pedido/"));
      if(!winner) {
        await expect.poll(()=>[page,other].some(p=>p.url().includes("/pedido/"))).toBe(true);
      }
      const loser=[page,other].find(p=>!p.url().includes("/pedido/"))!;
      await expect(loser.locator("form").getByRole("alert").first()).toContainText(/estoque|finalizar|disponível/i);
      expect((await query("select stock_quantity from public.product_inventory where product_id=$1",[item.productId])).rows[0].stock_quantity).toBe(0);
      await loser.locator("form").getByRole("alert").first().scrollIntoViewIfNeeded();
      await visual(loser,info,"ultima-unidade-negada");
      expect(errors.flat()).toEqual([]);
    } finally { await second.close(); }
  });
  test("duplo envio e repetição da requisição mantêm pedido e baixa únicos", async ({page}) => {
    const errors=watchErrors(page); const item=await seedBuyerProduct(3);
    await addBuyerProduct(page,item.productSlug); await fillCheckout(page);
    const captured=actionRequest(page);
    await page.getByRole("button",{name:"Continuar no WhatsApp",exact:true}).dblclick();
    const request=await captured;
    await expect(page.getByRole("heading",{name:"Pedido criado com sucesso!"})).toBeVisible();
    const orderId=new URL(page.url()).pathname.split("/").at(-1)!;
    const responses=await Promise.all([replayAction(page,request),replayAction(page,request)]);
    expect(responses.map(response=>response.status()).every(status=>status<500)).toBe(true);
    expect((await query("select count(*)::int as total from public.order_items where product_id=$1",[item.productId])).rows[0].total).toBe(1);
    expect((await query("select stock_quantity from public.product_inventory where product_id=$1",[item.productId])).rows[0].stock_quantity).toBe(2);
    await page.reload(); expect(new URL(page.url()).pathname.endsWith(orderId)).toBe(true);
    expect(errors).toEqual([]);
  });
});

test("controles do carrinho funcionam por formulário sem JavaScript",async({page,browser},info)=>{
  test.skip(process.env.E2E_ISOLATED_SUPABASE!=="1","Only disposable loopback services.");
  const item=await seedBuyerProduct(3);
  await addBuyerProduct(page,item.productSlug);
  const context=await browser.newContext({baseURL:"http://127.0.0.1:3100",javaScriptEnabled:false,viewport:info.project.use.viewport});
  try {
    await context.addCookies(await page.context().cookies());
    const plain=await context.newPage();
    await plain.goto("/loja/"+slug+"/carrinho");
    await expect(plain.getByText(item.name,{exact:true})).toBeVisible();
    const update=plain.waitForResponse(response=>response.request().method()==="POST");
    await plain.getByRole("button",{name:"Aumentar quantidade",exact:true}).click({noWaitAfter:true});
    const response=await update;
    console.log("VEXO_NATIVE_CART:"+JSON.stringify({status:response.status(),type:response.headers()["content-type"]}));
    await plain.waitForLoadState("domcontentloaded");
    await expect(plain.getByText(/R\$\s*240,00/).first()).toBeVisible();
    await plain.reload();
    await expect(plain.getByText(/R\$\s*240,00/).first()).toBeVisible();
    await plain.getByRole("button",{name:"Remover",exact:true}).click({noWaitAfter:true});
    await expect(plain.getByRole("heading",{name:/carrinho está vazio/i})).toBeVisible();
  } catch(error) {
    const plain=context.pages()[0];
    if(plain) {
      const body=await plain.locator("body").innerText({timeout:1500}).catch(()=>"[document still navigating]");
      console.log("VEXO_NATIVE_FAILURE:"+JSON.stringify({cause:String(error),path:new URL(plain.url()).pathname,body:body.slice(0,3000)}));
      if(body!=="[document still navigating]") await visual(plain,info,"falha-carrinho-sem-js");
    }
    throw error;
  } finally { await context.close(); }
});

test.afterEach(async({page},info)=>{
  if(info.status!==info.expectedStatus && info.project.name==="mobile-360") {
    const credentials=(await page.context().cookies()).find(value=>value.name==="vexo_cart_"+slug);
    if(credentials) console.log("VEXO_CART_FAILURE:"+JSON.stringify((await query("select ci.quantity,p.price,p.promotional_price from public.cart_items ci join public.products p on p.id=ci.product_id where ci.cart_id=$1",[credentials.value.split(".")[1]])).rows));
    await visual(page,info,"falha-comprador");
    console.log("VEXO_FAILED_PAGE:"+(await page.locator("body").innerText()).slice(0,4000));
  }
});
