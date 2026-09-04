import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * D17.3.2 — mesmo padrão de mock já usado no projeto para dependências
 * externas (`tests/unit/melhorenvio-quote.test.ts` mocka `global.fetch`;
 * aqui mockamos o módulo nativo `node:dns/promises`, nunca uma consulta
 * DNS real em teste unitário, conforme exigido pelo ticket D17.3.2
 * (Etapa 22).
 */
const resolveTxtMock = vi.fn();
vi.mock("node:dns/promises", () => ({
  resolveTxt: (...args: unknown[]) => resolveTxtMock(...args),
}));

async function importModule() {
  return import("@/lib/security/dns-verification");
}

async function importChallengeModule() {
  return import("@/lib/security/domain-challenge");
}

describe("buildChallengeRecordName", () => {
  beforeEach(() => {
    vi.resetModules();
    resolveTxtMock.mockReset();
  });

  it("prefixa _vexo-challenge. ao domínio", async () => {
    const { buildChallengeRecordName } = await importModule();
    expect(buildChallengeRecordName("minhaloja.com.br")).toBe("_vexo-challenge.minhaloja.com.br");
  });

  it("remove um ponto final (forma absoluta de FQDN) antes de montar o nome", async () => {
    const { buildChallengeRecordName } = await importModule();
    expect(buildChallengeRecordName("minhaloja.com.br.")).toBe("_vexo-challenge.minhaloja.com.br");
  });

  it("normaliza para lowercase", async () => {
    const { buildChallengeRecordName } = await importModule();
    expect(buildChallengeRecordName("MinhaLoja.COM.br")).toBe("_vexo-challenge.minhaloja.com.br");
  });
});

describe("checkDomainChallengeTxt", () => {
  beforeEach(() => {
    vi.resetModules();
    resolveTxtMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("1) TXT correto → match", async () => {
    const { hashDomainChallenge } = await importChallengeModule();
    const { checkDomainChallengeTxt } = await importModule();
    const token = "a".repeat(32);
    const expectedHash = hashDomainChallenge(token);
    resolveTxtMock.mockResolvedValue([[token]]);

    const result = await checkDomainChallengeTxt("minhaloja.com.br", expectedHash);
    expect(result).toEqual({ outcome: "match" });
    expect(resolveTxtMock).toHaveBeenCalledWith("_vexo-challenge.minhaloja.com.br");
  });

  it("2) TXT incorreto (token errado) → no_match", async () => {
    const { hashDomainChallenge } = await importChallengeModule();
    const { checkDomainChallengeTxt } = await importModule();
    const expectedHash = hashDomainChallenge("a".repeat(32));
    resolveTxtMock.mockResolvedValue([["b".repeat(32)]]);

    const result = await checkDomainChallengeTxt("minhaloja.com.br", expectedHash);
    expect(result).toEqual({ outcome: "no_match" });
  });

  it("3) múltiplos TXT → encontra o match em qualquer posição", async () => {
    const { hashDomainChallenge } = await importChallengeModule();
    const { checkDomainChallengeTxt } = await importModule();
    const token = "c".repeat(32);
    const expectedHash = hashDomainChallenge(token);
    // 3 registros TXT não relacionados + o correto no meio.
    resolveTxtMock.mockResolvedValue([["v=spf1 include:_spf.example.com ~all"], [token], ["outro-valor-qualquer"]]);

    const result = await checkDomainChallengeTxt("minhaloja.com.br", expectedHash);
    expect(result).toEqual({ outcome: "match" });
  });

  it("4) TXT dividido em segmentos é reconstruído (join) antes de comparar", async () => {
    const { hashDomainChallenge } = await importChallengeModule();
    const { checkDomainChallengeTxt } = await importModule();
    const token = "d".repeat(32);
    const expectedHash = hashDomainChallenge(token);
    // O mesmo TXT chega dividido em 2 segmentos, como o resolver do Node entrega para strings longas.
    const half = token.length / 2;
    resolveTxtMock.mockResolvedValue([[token.slice(0, half), token.slice(half)]]);

    const result = await checkDomainChallengeTxt("minhaloja.com.br", expectedHash);
    expect(result).toEqual({ outcome: "match" });
  });

  it("é case-insensitive (TXT publicado em maiúsculas ainda casa)", async () => {
    const { hashDomainChallenge } = await importChallengeModule();
    const { checkDomainChallengeTxt } = await importModule();
    const token = "e".repeat(32);
    const expectedHash = hashDomainChallenge(token);
    resolveTxtMock.mockResolvedValue([[token.toUpperCase()]]);

    const result = await checkDomainChallengeTxt("minhaloja.com.br", expectedHash);
    expect(result).toEqual({ outcome: "match" });
  });

  it("5) domínio/registro inexistente (ENOTFOUND) → not_found", async () => {
    const { checkDomainChallengeTxt } = await importModule();
    const err = Object.assign(new Error("queryTxt ENOTFOUND"), { code: "ENOTFOUND" });
    resolveTxtMock.mockRejectedValue(err);

    const result = await checkDomainChallengeTxt("minhaloja.com.br", "deadbeef");
    expect(result).toEqual({ outcome: "not_found" });
  });

  it("5b) sem registros do tipo (ENODATA) → not_found", async () => {
    const { checkDomainChallengeTxt } = await importModule();
    const err = Object.assign(new Error("queryTxt ENODATA"), { code: "ENODATA" });
    resolveTxtMock.mockRejectedValue(err);

    const result = await checkDomainChallengeTxt("minhaloja.com.br", "deadbeef");
    expect(result).toEqual({ outcome: "not_found" });
  });

  it("6) erro transitório de DNS (SERVFAIL) → error/dns_error, nunca lança", async () => {
    const { checkDomainChallengeTxt } = await importModule();
    const err = Object.assign(new Error("queryTxt SERVFAIL"), { code: "ESERVFAIL" });
    resolveTxtMock.mockRejectedValue(err);

    const result = await checkDomainChallengeTxt("minhaloja.com.br", "deadbeef");
    expect(result).toEqual({ outcome: "error", reason: "dns_error" });
  });

  it("6b) timeout → error/timeout, nunca fica pendurado indefinidamente", async () => {
    vi.useFakeTimers();
    const { checkDomainChallengeTxt } = await importModule();
    // Nunca resolve nem rejeita — simula uma consulta pendurada.
    resolveTxtMock.mockReturnValue(new Promise(() => {}));

    const resultPromise = checkDomainChallengeTxt("minhaloja.com.br", "deadbeef");
    await vi.advanceTimersByTimeAsync(6_000);
    const result = await resultPromise;
    expect(result).toEqual({ outcome: "error", reason: "timeout" });
  });

  it("resposta vazia (nenhum TXT) → no_match, nunca match por acidente", async () => {
    const { checkDomainChallengeTxt } = await importModule();
    resolveTxtMock.mockResolvedValue([]);

    const result = await checkDomainChallengeTxt("minhaloja.com.br", "deadbeef");
    expect(result).toEqual({ outcome: "no_match" });
  });

  it("9/10) token antigo (pré-rotação) não bate contra o hash do novo challenge", async () => {
    const { hashDomainChallenge, createDomainChallenge } = await importChallengeModule();
    const { checkDomainChallengeTxt } = await importModule();

    const first = createDomainChallenge(new Date("2026-01-01T00:00:00.000Z"));
    const second = createDomainChallenge(new Date("2026-01-02T00:00:00.000Z"));

    // DNS ainda tem o token ANTIGO publicado, mas o banco já foi rotacionado para o hash do challenge novo.
    resolveTxtMock.mockResolvedValue([[first.token]]);
    const staleResult = await checkDomainChallengeTxt("minhaloja.com.br", second.record.verificationTokenHash);
    expect(staleResult).toEqual({ outcome: "no_match" });

    // DNS com o token NOVO bate contra o hash novo.
    resolveTxtMock.mockResolvedValue([[second.token]]);
    const freshResult = await checkDomainChallengeTxt("minhaloja.com.br", second.record.verificationTokenHash);
    expect(freshResult).toEqual({ outcome: "match" });
    expect(hashDomainChallenge(second.token)).toBe(second.record.verificationTokenHash);
  });
});
