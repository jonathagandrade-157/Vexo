import { describe, expect, it } from "vitest";

import {
  createOrderAccessToken,
  deriveOrderAccessKey,
  ORDER_ACCESS_TTL_SECONDS,
  verifyOrderAccessToken,
} from "@/lib/security/order-access-token";

const key = deriveOrderAccessKey("test-secret-with-enough-length");
const otherKey = deriveOrderAccessKey("another-secret-with-enough-length");
const tenantId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const now = Date.UTC(2026, 10, 7, 12, 0, 0);

describe("order access token", () => {
  it("valida o token emitido para o mesmo tenant/pedido", () => {
    const token = createOrderAccessToken({ key, tenantId, orderId, now });
    expect(verifyOrderAccessToken({ key, tenantId, orderId, token, now })).toBe("valid");
    expect(verifyOrderAccessToken({ key, tenantId: tenantId.toUpperCase(), orderId, token, now })).toBe("valid");
  });

  it("expira exatamente no limite e não antes", () => {
    const token = createOrderAccessToken({ key, tenantId, orderId, now });
    const limit = now + ORDER_ACCESS_TTL_SECONDS * 1000;
    expect(verifyOrderAccessToken({ key, tenantId, orderId, token, now: limit - 1000 })).toBe("valid");
    expect(verifyOrderAccessToken({ key, tenantId, orderId, token, now: limit })).toBe("expired");
  });

  it("recusa troca de loja, de pedido ou de chave", () => {
    const token = createOrderAccessToken({ key, tenantId, orderId, now });
    expect(verifyOrderAccessToken({ key, tenantId: "33333333-3333-4333-8333-333333333333", orderId, token, now })).toBe("invalid");
    expect(verifyOrderAccessToken({ key, tenantId, orderId: "44444444-4444-4444-8444-444444444444", token, now })).toBe("invalid");
    expect(verifyOrderAccessToken({ key: otherKey, tenantId, orderId, token, now })).toBe("invalid");
  });

  it("recusa expiração alterada, inclusive representação alternativa do mesmo número", () => {
    const token = createOrderAccessToken({ key, tenantId, orderId, now });
    const [exp, sig] = token.split(".") as [string, string];
    const extended = (Number.parseInt(exp, 36) + 86400).toString(36);
    expect(verifyOrderAccessToken({ key, tenantId, orderId, token: `${extended}.${sig}`, now })).toBe("invalid");
    expect(verifyOrderAccessToken({ key, tenantId, orderId, token: `0${exp}.${sig}`, now })).toBe("invalid");
  });

  it("um token expirado com assinatura forjada nunca é reportado como expirado", () => {
    const past = (Math.floor(now / 1000) - 10).toString(36);
    expect(verifyOrderAccessToken({ key, tenantId, orderId, token: `${past}.${"A".repeat(43)}`, now })).toBe("invalid");
  });

  it.each([undefined, null, "", ".", "abc", "a.b.c", "x".repeat(200), "zz.!!!", `1.${"A".repeat(44)}`])(
    "entrada malformada %s é inválida sem lançar",
    (token) => {
      expect(verifyOrderAccessToken({ key, tenantId, orderId, token, now })).toBe("invalid");
    },
  );

  it("exige UUIDs e chave com tamanho mínimo", () => {
    expect(() => createOrderAccessToken({ key, tenantId: "1", orderId, now })).toThrow();
    expect(verifyOrderAccessToken({ key, tenantId, orderId: "1001", token: "a.b", now })).toBe("invalid");
    expect(() => deriveOrderAccessKey("short")).toThrow();
  });

  it("deriva chave distinta do segredo bruto (separação de finalidade)", () => {
    expect(key.equals(Buffer.from("test-secret-with-enough-length"))).toBe(false);
    expect(key).toHaveLength(32);
  });
});
