import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { getClientIp, rateLimitedResponse } from "@/lib/security/rate-limit";

/**
 * D15-S.2 — só a parte pura de lib/security/rate-limit.ts (checkRateLimit
 * em si depende do Postgres via service-role client, coberta em
 * tests/integration/rate-limit.test.ts, e é mockada em todo teste de
 * Route Handler — mesmo padrão de lookupCep em
 * tests/unit/cep-autofill-route.test.ts).
 */

function requestWithHeaders(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/shipping/quote", { headers });
}

describe("getClientIp", () => {
  it("usa o primeiro valor de x-forwarded-for (o mais próximo do cliente real)", () => {
    expect(getClientIp(requestWithHeaders({ "x-forwarded-for": "203.0.113.5, 10.0.0.1, 10.0.0.2" }))).toBe("203.0.113.5");
  });

  it("aceita x-forwarded-for com um único valor, sem vírgula", () => {
    expect(getClientIp(requestWithHeaders({ "x-forwarded-for": "203.0.113.5" }))).toBe("203.0.113.5");
  });

  it("recorre a x-real-ip quando x-forwarded-for está ausente", () => {
    expect(getClientIp(requestWithHeaders({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
  });

  it("prefere x-forwarded-for quando os dois headers estão presentes", () => {
    expect(getClientIp(requestWithHeaders({ "x-forwarded-for": "203.0.113.5", "x-real-ip": "198.51.100.9" }))).toBe("203.0.113.5");
  });

  it("null quando nenhum dos dois headers está presente", () => {
    expect(getClientIp(requestWithHeaders({}))).toBeNull();
  });

  it("ignora espaços em branco ao redor do IP", () => {
    expect(getClientIp(requestWithHeaders({ "x-forwarded-for": "  203.0.113.5  , 10.0.0.1" }))).toBe("203.0.113.5");
  });
});

describe("rateLimitedResponse", () => {
  it("HTTP 429 com corpo genérico (nunca revela chave/tenant/IP internos)", async () => {
    const response = rateLimitedResponse(30);
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body).toEqual({ status: "rate_limited" });
    expect(JSON.stringify(body)).not.toMatch(/tenant|ip|key/i);
  });

  it("header Retry-After com os segundos informados", () => {
    const response = rateLimitedResponse(42);
    expect(response.headers.get("Retry-After")).toBe("42");
  });

  it("nunca um Retry-After menor que 1, mesmo com retryAfterSeconds <= 0", () => {
    expect(rateLimitedResponse(0).headers.get("Retry-After")).toBe("1");
    expect(rateLimitedResponse(-5).headers.get("Retry-After")).toBe("1");
  });
});
