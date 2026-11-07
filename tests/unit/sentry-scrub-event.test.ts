import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import { scrubSentryEvent, scrubSentryTransaction, type TransactionEvent } from "@/lib/sentry/scrub-event";

const ORDER_URL = "https://loja.example/loja/demo/pedido/22222222-2222-4222-8222-222222222222?acesso=abc123.SIGNATURE_value-xyz";

describe("Sentry scrubbing", () => {
  it("redige a prova de acesso do pedido em request, breadcrumbs e mensagens", () => {
    const event = scrubSentryEvent(
      {
        type: undefined,
        message: `Falha ao abrir ${ORDER_URL}`,
        request: { url: ORDER_URL, query_string: "acesso=abc123.SIGNATURE_value-xyz" },
        breadcrumbs: [{ category: "navigation", data: { from: "/", to: ORDER_URL } }],
        exception: { values: [{ value: `GET ${ORDER_URL} failed` }] },
      } as ErrorEvent,
      {},
    );
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("SIGNATURE_value");
    expect(serialized).toContain("acesso=[Filtered]");
    expect(event.request?.url).toContain("/pedido/22222222-2222-4222-8222-222222222222?acesso=[Filtered]");
  });

  it("aplica a mesma redação em transações e spans", () => {
    const event = scrubSentryTransaction(
      {
        type: "transaction",
        transaction: "/loja/[slug]/pedido/[orderId]",
        request: { url: ORDER_URL },
        spans: [{ description: `GET ${ORDER_URL}`, data: { "http.url": ORDER_URL } }],
        breadcrumbs: [{ data: { url: ORDER_URL } }],
      } as unknown as TransactionEvent,
      {},
    );
    expect(JSON.stringify(event)).not.toContain("SIGNATURE_value");
  });

  it("mantém URLs sem parâmetros sensíveis inalteradas", () => {
    const url = "https://loja.example/loja/demo/produto/camisa?cor=azul&tamanho=m";
    const event = scrubSentryEvent({ type: undefined, request: { url } } as ErrorEvent, {});
    expect(event.request?.url).toBe(url);
  });
});
