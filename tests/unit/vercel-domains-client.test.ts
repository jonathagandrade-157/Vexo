import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * D17.5.1 — testa `lib/vercel/domains.ts` mockando `global.fetch`
 * diretamente (mesmo padrão de `tests/unit/melhorenvio-quote.test.ts`) —
 * nenhuma chamada real à Vercel. `getVercelEnv()` (lib/env.ts) não é
 * mockado — os valores reais de `process.env` (setados abaixo) já são
 * suficientes, mesmo padrão do teste do Melhor Envio.
 */
const ORIGINAL_ENV = { ...process.env };

function setEnv() {
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    NEXT_PUBLIC_STOREFRONT_DOMAIN_SUFFIX: "vexo.local",
    VERCEL_API_TOKEN: "vca_test_token_never_logged",
    VERCEL_PROJECT_ID: "prj_test",
    VERCEL_TEAM_ID: "team_test",
  });
}

async function importModule() {
  return import("@/lib/vercel/domains");
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("lib/vercel/domains.ts", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    setEnv();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...ORIGINAL_ENV };
    vi.clearAllMocks();
  });

  describe("addVercelDomain", () => {
    it("registro bem-sucedido (2xx) → ok, alreadyRegistered=false", async () => {
      const { addVercelDomain } = await importModule();
      vi.mocked(global.fetch).mockResolvedValue(
        jsonResponse(200, { name: "loja.com.br", apexName: "loja.com.br", projectId: "prj_test", verified: true }),
      );

      const result = await addVercelDomain("loja.com.br");
      expect(result).toEqual({
        ok: true,
        domain: { name: "loja.com.br", apexName: "loja.com.br", projectId: "prj_test", verified: true },
        alreadyRegistered: false,
      });
      expect(vi.mocked(global.fetch).mock.calls[0]![0]).toContain("/v10/projects/prj_test/domains");
    });

    it("token nunca aparece na URL nem é logado — só no header Authorization", async () => {
      const { addVercelDomain } = await importModule();
      vi.mocked(global.fetch).mockResolvedValue(
        jsonResponse(200, { name: "loja.com.br", apexName: "loja.com.br", projectId: "prj_test", verified: true }),
      );
      await addVercelDomain("loja.com.br");

      const [url, init] = vi.mocked(global.fetch).mock.calls[0]!;
      expect(String(url)).not.toContain("vca_test_token_never_logged");
      expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer vca_test_token_never_logged" });
    });

    it("domínio já existe no nosso projeto (400 + GET confirma nosso projectId) → sucesso lógico, alreadyRegistered=true", async () => {
      const { addVercelDomain } = await importModule();
      vi.mocked(global.fetch)
        .mockResolvedValueOnce(jsonResponse(400, { error: { code: "domain_already_in_use" } })) // POST
        .mockResolvedValueOnce(jsonResponse(200, { name: "loja.com.br", apexName: "loja.com.br", projectId: "prj_test", verified: true })); // GET

      const result = await addVercelDomain("loja.com.br");
      expect(result).toEqual({
        ok: true,
        domain: { name: "loja.com.br", apexName: "loja.com.br", projectId: "prj_test", verified: true },
        alreadyRegistered: true,
      });
    });

    it("domínio pertence a outro projeto (400 + GET no nosso projeto retorna 404) → registered_other_project, nunca move automaticamente", async () => {
      const { addVercelDomain } = await importModule();
      vi.mocked(global.fetch)
        .mockResolvedValueOnce(jsonResponse(400, { error: { code: "forbidden" } })) // POST
        .mockResolvedValueOnce(jsonResponse(404, { error: { code: "not_found" } })); // GET no nosso projeto

      const result = await addVercelDomain("loja-de-outro.com.br");
      expect(result).toEqual({ ok: false, code: "registered_other_project" });
      // Nunca chama o endpoint de move.
      const calledUrls = vi.mocked(global.fetch).mock.calls.map((c) => String(c[0]));
      expect(calledUrls.some((u) => u.includes("/move"))).toBe(false);
    });

    it.each([
      [401, "unauthorized"],
      [403, "forbidden"],
      [404, "not_found"],
      [409, "conflict"],
      [410, "gone"],
    ] as const)("status %d → code %s", async (status, code) => {
      const { addVercelDomain } = await importModule();
      vi.mocked(global.fetch).mockResolvedValue(jsonResponse(status, { error: { code: "x" } }));

      const result = await addVercelDomain("loja.com.br");
      expect(result).toEqual({ ok: false, code });
    });

    it("429 com Retry-After → rate_limited com retryAfterSeconds", async () => {
      const { addVercelDomain } = await importModule();
      vi.mocked(global.fetch).mockResolvedValue(jsonResponse(429, { error: { code: "rate_limited" } }, { "Retry-After": "30" }));

      const result = await addVercelDomain("loja.com.br");
      expect(result).toEqual({ ok: false, code: "rate_limited", retryAfterSeconds: 30 });
    });

    it("timeout (fetch nunca resolve por conta própria, só reage ao AbortSignal) → code timeout, nunca fica pendurado", async () => {
      vi.useFakeTimers();
      const { addVercelDomain } = await importModule();
      // Mesmo comportamento do `fetch` real: a promise só se resolve/rejeita
      // quando o AbortSignal dispara — um mock que ignora o signal (como um
      // `new Promise(() => {})` puro) não reproduz o timeout de verdade,
      // porque `fetchWithTimeout` depende do próprio `fetch` reagir ao abort.
      vi.mocked(global.fetch).mockImplementation((_url, init) => {
        return new Promise((_resolve, reject) => {
          const signal = (init as RequestInit | undefined)?.signal;
          signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      });

      const resultPromise = addVercelDomain("loja.com.br");
      await vi.advanceTimersByTimeAsync(11_000);
      const result = await resultPromise;
      expect(result).toEqual({ ok: false, code: "timeout" });
      vi.useRealTimers();
    });

    it("erro de rede (fetch rejeita) → code network_error, nunca lança", async () => {
      const { addVercelDomain } = await importModule();
      vi.mocked(global.fetch).mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));

      await expect(addVercelDomain("loja.com.br")).resolves.toEqual({ ok: false, code: "network_error" });
    });

    it("resposta 2xx com corpo inesperado (sem os campos exigidos) → invalid_response, nunca lança", async () => {
      const { addVercelDomain } = await importModule();
      vi.mocked(global.fetch).mockResolvedValue(jsonResponse(200, { unexpected: true }));

      const result = await addVercelDomain("loja.com.br");
      expect(result).toEqual({ ok: false, code: "invalid_response" });
    });

    it("resposta com corpo não-JSON → tratada como invalid_response, nunca lança", async () => {
      const { addVercelDomain } = await importModule();
      vi.mocked(global.fetch).mockResolvedValue(new Response("not json", { status: 200 }));

      const result = await addVercelDomain("loja.com.br");
      expect(result).toEqual({ ok: false, code: "invalid_response" });
    });
  });

  describe("getVercelDomainConfig", () => {
    it("misconfigured=false → ok", async () => {
      const { getVercelDomainConfig } = await importModule();
      vi.mocked(global.fetch).mockResolvedValue(jsonResponse(200, { misconfigured: false }));

      const result = await getVercelDomainConfig("loja.com.br");
      expect(result).toEqual({ ok: true, config: { misconfigured: false } });
    });

    it("misconfigured=true → ok, config reflete", async () => {
      const { getVercelDomainConfig } = await importModule();
      vi.mocked(global.fetch).mockResolvedValue(jsonResponse(200, { misconfigured: true }));

      const result = await getVercelDomainConfig("loja.com.br");
      expect(result).toEqual({ ok: true, config: { misconfigured: true } });
    });

    it("erro de rede → network_error", async () => {
      const { getVercelDomainConfig } = await importModule();
      vi.mocked(global.fetch).mockRejectedValue(new Error("fail"));

      await expect(getVercelDomainConfig("loja.com.br")).resolves.toEqual({ ok: false, code: "network_error" });
    });
  });

  describe("verifyVercelDomain / getVercelDomain / removeVercelDomain", () => {
    it("getVercelDomain: 404 → not_found", async () => {
      const { getVercelDomain } = await importModule();
      vi.mocked(global.fetch).mockResolvedValue(jsonResponse(404, {}));

      const result = await getVercelDomain("loja.com.br");
      expect(result).toEqual({ ok: false, code: "not_found" });
    });

    it("verifyVercelDomain: 2xx → ok com domínio", async () => {
      const { verifyVercelDomain } = await importModule();
      vi.mocked(global.fetch).mockResolvedValue(
        jsonResponse(200, { name: "loja.com.br", apexName: "loja.com.br", projectId: "prj_test", verified: true }),
      );

      const result = await verifyVercelDomain("loja.com.br");
      expect(result.ok).toBe(true);
    });

    it("removeVercelDomain: 2xx → ok true, sem corpo exigido", async () => {
      const { removeVercelDomain } = await importModule();
      vi.mocked(global.fetch).mockResolvedValue(new Response(null, { status: 200 }));

      const result = await removeVercelDomain("loja.com.br");
      expect(result).toEqual({ ok: true });
    });

    it("removeVercelDomain: 409 (projeto em transferência) → conflict", async () => {
      const { removeVercelDomain } = await importModule();
      vi.mocked(global.fetch).mockResolvedValue(jsonResponse(409, {}));

      const result = await removeVercelDomain("loja.com.br");
      expect(result).toEqual({ ok: false, code: "conflict" });
    });
  });
});
