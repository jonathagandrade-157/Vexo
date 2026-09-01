import { describe, expect, it } from "vitest";

import {
  buildStoreSetupChecklist,
  hasCategories,
  hasIdentityConfigured,
  hasMinimumStoreInfo,
  hasPaymentConfigured,
  hasProducts,
  hasShippingConfigured,
  productsCopy,
  storefrontHref,
  type StoreSetupRawSignals,
} from "@/features/painel/store-setup-logic";

/**
 * D12.2.2 — checklist de configuração do painel. Toda a determinação de
 * "concluído ou não" vive em `store-setup-logic.ts` como funções puras
 * (sem banco, sem React) — testável sem infraestrutura, mesmo princípio
 * já usado em `features/onboarding/progress-logic.ts` (D12.2).
 */

const EMPTY: StoreSetupRawSignals = {
  storeName: "",
  segment: null,
  instagramHandle: null,
  whatsappPhone: null,
  contactEmail: null,
  logoUrl: null,
  productCount: 0,
  categoryCount: 0,
  paymentConnected: false,
  shippingEnabled: false,
  activeShippingMethodCount: 0,
};

const FULLY_CONFIGURED: StoreSetupRawSignals = {
  storeName: "Loja da Ana",
  segment: "apparel",
  instagramHandle: "lojadaana",
  whatsappPhone: "11999998888",
  contactEmail: "contato@lojadaana.com.br",
  logoUrl: "tenant-a/logo/logo.png",
  productCount: 3,
  categoryCount: 2,
  paymentConnected: true,
  shippingEnabled: true,
  activeShippingMethodCount: 1,
};

// tenant sem nenhuma configuração
describe("tenant sem nenhuma configuração", () => {
  it("nenhum item é considerado concluído", () => {
    const checklist = buildStoreSetupChecklist(EMPTY, "ecommerce");
    expect(checklist.items.every((i) => !i.completed)).toBe(true);
    expect(checklist.completedCount).toBe(0);
    expect(checklist.percentage).toBe(0);
    expect(checklist.allComplete).toBe(false);
  });
});

// tenant com informações configuradas
describe("hasMinimumStoreInfo — informações da loja", () => {
  it("true só quando nome/segmento/instagram/whatsapp/email estão todos preenchidos", () => {
    expect(hasMinimumStoreInfo(FULLY_CONFIGURED)).toBe(true);
  });

  it("false se faltar qualquer um dos 5 campos", () => {
    expect(hasMinimumStoreInfo({ ...FULLY_CONFIGURED, segment: null })).toBe(false);
    expect(hasMinimumStoreInfo({ ...FULLY_CONFIGURED, instagramHandle: null })).toBe(false);
    expect(hasMinimumStoreInfo({ ...FULLY_CONFIGURED, whatsappPhone: "" })).toBe(false);
    expect(hasMinimumStoreInfo({ ...FULLY_CONFIGURED, contactEmail: "   " })).toBe(false);
    expect(hasMinimumStoreInfo({ ...FULLY_CONFIGURED, storeName: "" })).toBe(false);
  });

  it("nunca considera a descrição (opcional) — sua ausência não afeta o resultado", () => {
    expect(hasMinimumStoreInfo(FULLY_CONFIGURED)).toBe(true);
  });
});

// tenant com produto
describe("hasProducts", () => {
  it("false com 0 produtos, true com pelo menos 1", () => {
    expect(hasProducts({ productCount: 0 })).toBe(false);
    expect(hasProducts({ productCount: 1 })).toBe(true);
    expect(hasProducts({ productCount: 50 })).toBe(true);
  });
});

// tenant com categoria
describe("hasCategories", () => {
  it("false com 0 categorias, true com pelo menos 1", () => {
    expect(hasCategories({ categoryCount: 0 })).toBe(false);
    expect(hasCategories({ categoryCount: 1 })).toBe(true);
  });
});

// tenant com pagamento
describe("hasPaymentConfigured", () => {
  it("reflete diretamente o status 'connected' de store_payment_providers", () => {
    expect(hasPaymentConfigured({ paymentConnected: false })).toBe(false);
    expect(hasPaymentConfigured({ paymentConnected: true })).toBe(true);
  });
});

// tenant com entrega
describe("hasShippingConfigured", () => {
  it("exige shipping_settings.enabled E pelo menos 1 método ativo — mesmo critério da RLS pública do storefront", () => {
    expect(hasShippingConfigured({ shippingEnabled: false, activeShippingMethodCount: 0 })).toBe(false);
    expect(hasShippingConfigured({ shippingEnabled: true, activeShippingMethodCount: 0 })).toBe(false);
    expect(hasShippingConfigured({ shippingEnabled: false, activeShippingMethodCount: 2 })).toBe(false);
    expect(hasShippingConfigured({ shippingEnabled: true, activeShippingMethodCount: 1 })).toBe(true);
  });
});

// identidade
describe("hasIdentityConfigured", () => {
  it("true só quando há uma logo enviada — nunca inferido de cores/modelo (sempre têm valor padrão)", () => {
    expect(hasIdentityConfigured({ logoUrl: null })).toBe(false);
    expect(hasIdentityConfigured({ logoUrl: "" })).toBe(false);
    expect(hasIdentityConfigured({ logoUrl: "tenant-a/logo/logo.png" })).toBe(true);
  });
});

// tenant totalmente configurado
describe("tenant totalmente configurado", () => {
  it("todos os 6 itens concluídos, 100%, allComplete true", () => {
    const checklist = buildStoreSetupChecklist(FULLY_CONFIGURED, "ecommerce");
    expect(checklist.items.every((i) => i.completed)).toBe(true);
    expect(checklist.completedCount).toBe(checklist.totalCount);
    expect(checklist.percentage).toBe(100);
    expect(checklist.allComplete).toBe(true);
  });
});

// percentual calculado corretamente
describe("percentual calculado dinamicamente", () => {
  it("3 de 6 concluídos → 50%", () => {
    const raw: StoreSetupRawSignals = {
      ...EMPTY,
      storeName: "Loja",
      segment: "apparel",
      instagramHandle: "loja",
      whatsappPhone: "11999998888",
      contactEmail: "a@b.com",
      logoUrl: "path/logo.png",
      productCount: 1,
    };
    const checklist = buildStoreSetupChecklist(raw, "ecommerce");
    expect(checklist.completedCount).toBe(3); // informacoes, identidade, produtos
    expect(checklist.totalCount).toBe(6);
    expect(checklist.percentage).toBe(50);
  });

  it("1 de 6 concluído → 17% (arredondado)", () => {
    const checklist = buildStoreSetupChecklist({ ...EMPTY, productCount: 1 }, "ecommerce");
    expect(checklist.completedCount).toBe(1);
    expect(checklist.percentage).toBe(17);
  });
});

// business_type — ecommerce
describe("business_type: ecommerce", () => {
  it("usa a copy padrão de produtos ('Cadastre seu primeiro produto' / 'Cadastrar produto')", () => {
    const checklist = buildStoreSetupChecklist(EMPTY, "ecommerce");
    const produtos = checklist.items.find((i) => i.key === "produtos")!;
    expect(produtos.title).toBe("Cadastre seu primeiro produto");
    expect(produtos.actionLabel).toBe("Cadastrar produto");
  });

  it("com produto cadastrado, mostra o título/descrição de concluído", () => {
    const checklist = buildStoreSetupChecklist({ ...EMPTY, productCount: 2 }, "ecommerce");
    const produtos = checklist.items.find((i) => i.key === "produtos")!;
    expect(produtos.title).toBe("Produtos");
    expect(produtos.description).toBe("Você já cadastrou seus produtos.");
    expect(produtos.completed).toBe(true);
  });
});

// business_type — restaurant
describe("business_type: restaurant", () => {
  it("usa linguagem de cardápio/pratos, não 'produtos'", () => {
    const checklist = buildStoreSetupChecklist(EMPTY, "restaurant");
    const produtos = checklist.items.find((i) => i.key === "produtos")!;
    expect(produtos.title).toBe("Adicione seus primeiros pratos");
    expect(produtos.actionLabel).toBe("Cadastrar prato");
  });

  it("concluído mostra 'Cardápio' / 'Você já cadastrou seus pratos.'", () => {
    const copy = productsCopy("restaurant", true);
    expect(copy.doneTitle).toBe("Cardápio");
    expect(copy.doneDescription).toBe("Você já cadastrou seus pratos.");
  });
});

// business_type — adega
describe("business_type: adega", () => {
  it("usa linguagem de produtos/catálogo (não pratos)", () => {
    const checklist = buildStoreSetupChecklist(EMPTY, "adega");
    const produtos = checklist.items.find((i) => i.key === "produtos")!;
    expect(produtos.title).toBe("Adicione seus primeiros produtos");
    expect(produtos.description).toMatch(/catálogo/);
  });
});

// business_type null/desconhecido (tenant legado) — não deve quebrar, cai no texto de ecommerce
describe("business_type ausente (tenant legado, D12.2)", () => {
  it("nunca lança exceção — usa a copy padrão de ecommerce como fallback", () => {
    expect(() => buildStoreSetupChecklist(EMPTY, null)).not.toThrow();
    const checklist = buildStoreSetupChecklist(EMPTY, null);
    const produtos = checklist.items.find((i) => i.key === "produtos")!;
    expect(produtos.title).toBe("Cadastre seu primeiro produto");
  });
});

// itens indisponíveis/opcionais não devem quebrar o cálculo
describe("sinais ausentes/zerados não quebram o cálculo", () => {
  it("todos os campos em seus valores 'vazios' (0/false/null/'') resultam num checklist válido, nunca uma exceção", () => {
    expect(() => buildStoreSetupChecklist(EMPTY, "ecommerce")).not.toThrow();
    const checklist = buildStoreSetupChecklist(EMPTY, "ecommerce");
    expect(checklist.items).toHaveLength(6);
    expect(checklist.percentage).toBe(0);
  });

  it("nunca conta 'visitou a página' como configurado — sinais puramente booleanos/contagem, nunca timestamps de acesso", () => {
    // Sanity check estrutural: StoreSetupRawSignals não tem nenhum campo de "última visita"/"último acesso".
    const keys = Object.keys(EMPTY);
    expect(keys.some((k) => /visit|access|view/i.test(k))).toBe(false);
  });
});

describe("storefrontHref", () => {
  it("é sempre derivado do slug real do tenant, nunca inventado", () => {
    expect(storefrontHref("loja-da-ana")).toBe("/loja/loja-da-ana");
  });
});

describe("StoreSetupChecklist — 6 itens na ordem documentada (D12.2.2 §2)", () => {
  it("informacoes, identidade, produtos, categorias, pagamentos, entrega, nessa ordem", () => {
    const checklist = buildStoreSetupChecklist(FULLY_CONFIGURED, "ecommerce");
    expect(checklist.items.map((i) => i.key)).toEqual([
      "informacoes",
      "identidade",
      "produtos",
      "categorias",
      "pagamentos",
      "entrega",
    ]);
  });

  it("todo item tem href e actionLabel não vazios", () => {
    const checklist = buildStoreSetupChecklist(EMPTY, "ecommerce");
    for (const item of checklist.items) {
      expect(item.href.startsWith("/")).toBe(true);
      expect(item.actionLabel.length).toBeGreaterThan(0);
    }
  });
});
