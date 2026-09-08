import { describe, expect, it } from "vitest";

import {
  buildHistoryEventDescription,
  resolveHistoryActionLabel,
  resolveHistoryActorLabel,
  resolveHistoryEntityLabel,
} from "@/features/history/messages";

/**
 * D18.4 (Fase 2) — funções puras de `features/history/messages.ts`, mesmo
 * princípio de `tests/unit/team-messages.test.ts` (testável sem DOM,
 * `environment: "node"`).
 */
describe("resolveHistoryActionLabel", () => {
  it("traduz uma action conhecida do catálogo", () => {
    expect(resolveHistoryActionLabel("PRODUCT_CREATED")).toBe("Produto criado");
    expect(resolveHistoryActionLabel("PRODUCT_UPDATED")).toBe("Produto atualizado");
    expect(resolveHistoryActionLabel("TEAM_MEMBER_INVITED")).toBe("Membro convidado");
    expect(resolveHistoryActionLabel("TENANT_PIX_SETTINGS_UPDATED")).toBe("Configurações de PIX atualizadas");
  });

  it("D18.5.1 — traduz os 6 eventos novos (aparência/checkout_mode/endereço/banners)", () => {
    expect(resolveHistoryActionLabel("TENANT_APPEARANCE_UPDATED")).toBe("Aparência da loja atualizada");
    expect(resolveHistoryActionLabel("TENANT_CHECKOUT_MODE_UPDATED")).toBe("Forma de receber pedidos atualizada");
    expect(resolveHistoryActionLabel("TENANT_ADDRESS_UPDATED")).toBe("Endereço da loja atualizado");
    expect(resolveHistoryActionLabel("STOREFRONT_BANNER_CREATED")).toBe("Banner criado");
    expect(resolveHistoryActionLabel("STOREFRONT_BANNER_UPDATED")).toBe("Banner atualizado");
    expect(resolveHistoryActionLabel("STOREFRONT_BANNER_DELETED")).toBe("Banner excluído");
  });

  it("§8 — action desconhecida (não catalogada) cai no fallback seguro, nunca no texto técnico bruto", () => {
    expect(resolveHistoryActionLabel("SOME_FUTURE_EVENT_NOT_YET_MAPPED")).toBe("Alteração registrada");
  });

  it("nunca inclui eventos de escopo Master (PLAN_*/FEATURE_*/PLAN_LIMIT_*) no catálogo traduzido — mesmo passando um desses cai no fallback, nunca com rótulo próprio", () => {
    for (const masterOnlyAction of ["PLAN_CREATED", "FEATURE_UPDATED", "PLAN_FEATURE_ENABLED", "PLAN_LIMIT_SET"]) {
      expect(resolveHistoryActionLabel(masterOnlyAction)).toBe("Alteração registrada");
    }
  });
});

describe("resolveHistoryEntityLabel", () => {
  it("traduz um resource_type conhecido", () => {
    expect(resolveHistoryEntityLabel("product")).toBe("Produto");
    expect(resolveHistoryEntityLabel("tenant_member")).toBe("Equipe");
    expect(resolveHistoryEntityLabel("tenant_domain")).toBe("Domínio");
  });

  it("D18.5.1 — traduz o novo tipo de entidade 'storefront_banner'", () => {
    expect(resolveHistoryEntityLabel("storefront_banner")).toBe("Banner");
  });

  it("resource_type nulo vira travessão, nunca quebra", () => {
    expect(resolveHistoryEntityLabel(null)).toBe("—");
  });

  it("resource_type desconhecido é exibido tal como veio, nunca escondido", () => {
    expect(resolveHistoryEntityLabel("something_new")).toBe("something_new");
  });
});

describe("resolveHistoryActorLabel — Fase 2 item 10", () => {
  it("actor_type='system' sempre mostra 'Sistema', nunca tenta um nome", () => {
    expect(resolveHistoryActorLabel({ actorType: "system", actorName: "deveria ser ignorado" })).toBe("Sistema");
  });

  it("actor_type='master' sempre mostra 'Equipe VEXO', nunca tenta um nome", () => {
    expect(resolveHistoryActorLabel({ actorType: "master", actorName: "deveria ser ignorado" })).toBe("Equipe VEXO");
  });

  it("actor_type='user' com nome resolvido mostra o nome", () => {
    expect(resolveHistoryActorLabel({ actorType: "user", actorName: "João" })).toBe("João");
  });

  it("actor_type='user' sem nome resolvido (profile removido/inexistente) mostra 'Usuário removido', nunca um UUID", () => {
    expect(resolveHistoryActorLabel({ actorType: "user", actorName: null })).toBe("Usuário removido");
  });
});

describe("buildHistoryEventDescription — §9", () => {
  it("descreve o primeiro campo relevante que mudou entre before/after", () => {
    expect(
      buildHistoryEventDescription({ action: "PRODUCT_UPDATED", before: { price: 1000 }, after: { price: 1200 } }),
    ).toBe("Preço alterado(a)");
    expect(
      buildHistoryEventDescription({
        action: "TENANT_STATUS_CHANGED",
        before: { status: "active" },
        after: { status: "suspended" },
      }),
    ).toBe("Status alterado(a)");
  });

  it("D18.5.1 — descreve mudanças nos campos novos (checkout_mode/endereço/aparência)", () => {
    expect(
      buildHistoryEventDescription({
        action: "TENANT_CHECKOUT_MODE_UPDATED",
        before: { checkout_mode: "vexo" },
        after: { checkout_mode: "whatsapp" },
      }),
    ).toBe("Forma de receber pedidos alterado(a)");
    expect(
      buildHistoryEventDescription({
        action: "TENANT_ADDRESS_UPDATED",
        before: { address_city: null },
        after: { address_city: "São Paulo" },
      }),
    ).toBe("Endereço alterado(a)");
    expect(
      buildHistoryEventDescription({
        action: "TENANT_APPEARANCE_UPDATED",
        before: { primary_color: "#000000" },
        after: { primary_color: "#ffffff" },
      }),
    ).toBe("Cor primária alterado(a)");
  });

  it("sem before/after (ex.: evento de criação) cai no rótulo da própria ação", () => {
    expect(buildHistoryEventDescription({ action: "PRODUCT_CREATED", before: null, after: { name: "Produto X" } })).toBe(
      "Produto criado",
    );
  });

  it("nunca serializa o objeto inteiro — before/after com uma chave sensível (já deveria ter sido redigida antes, mas mesmo que não fosse) nunca aparece na descrição", () => {
    const description = buildHistoryEventDescription({
      action: "PAYMENT_CONNECTION_CREATED",
      before: null,
      after: { access_token: "should-never-appear-in-description", provider: "mercadopago" },
    });
    expect(description).not.toContain("should-never-appear-in-description");
  });
});
