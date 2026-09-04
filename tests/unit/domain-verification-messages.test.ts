import { describe, expect, it, vi } from "vitest";

import {
  copyToClipboard,
  DNS_TXT_RECORD_TYPE,
  DNS_TXT_TTL_SECONDS,
  resolveVerificationMessage,
  resolveVerificationUiState,
} from "@/features/settings/domain-verification-messages";

/**
 * D17.3.3 — testa a lógica pura por trás de `DomainVerificationCard`
 * (`components/painel/domain-verification-card.tsx`) sem depender de DOM:
 * este projeto roda `vitest` com `environment: "node"`, sem jsdom nem
 * `@testing-library/react` (mesma limitação já documentada em
 * `tests/unit/product-image-uploader-no-nested-form.test.ts`, D11.7) — a
 * lógica de mensagem/visibilidade foi extraída para
 * `features/settings/domain-verification-messages.ts` exatamente para
 * poder ser testada de verdade, em vez de só uma checagem estática de
 * texto-fonte. Cobre os cenários 3/4/9/10/11/12/13 do ticket D17.3.3 §18.
 */

describe("resolveVerificationMessage", () => {
  it("pending sem challenge: pede para configurar o TXT (cenário 1)", () => {
    expect(resolveVerificationMessage("pending", false)).toBe("Configure o registro TXT para iniciar a verificação.");
  });

  it("verifying com challenge visível: instrui a adicionar o TXT abaixo", () => {
    expect(resolveVerificationMessage("verifying", true)).toBe(
      "Adicione o registro TXT abaixo e depois clique em Verificar domínio.",
    );
  });

  it("verifying sem challenge visível (página recarregada): pede para gerar novas instruções", () => {
    expect(resolveVerificationMessage("verifying", false)).toBe(
      "Você já iniciou a verificação deste domínio. Gere novas instruções de DNS para continuar.",
    );
  });

  it("active: domínio verificado (cenário 9)", () => {
    expect(resolveVerificationMessage("active", false)).toBe("Domínio verificado.");
  });

  it("expired (independente do status): pede para iniciar nova verificação (cenário 13)", () => {
    expect(resolveVerificationMessage("pending", false, { expired: true })).toBe(
      "Este desafio expirou. Inicie uma nova verificação.",
    );
  });

  it("reason=no_match: TXT ainda não encontrado (cenário 10)", () => {
    expect(resolveVerificationMessage("verifying", true, { reason: "no_match" })).toBe(
      "O registro TXT ainda não foi encontrado. Confira os dados de DNS e tente novamente.",
    );
  });

  it("reason=not_found: registro não encontrado, propagação pode demorar (cenário 11)", () => {
    expect(resolveVerificationMessage("verifying", true, { reason: "not_found" })).toBe(
      "Não encontramos o registro TXT. A propagação do DNS pode levar algum tempo.",
    );
  });

  it("reason=dns_error: mensagem genérica, nunca o motivo técnico exato (cenário 12)", () => {
    expect(resolveVerificationMessage("verifying", true, { reason: "dns_error" })).toBe(
      "Não foi possível consultar o DNS agora. Tente novamente em alguns instantes.",
    );
  });

  it("expired tem prioridade sobre qualquer reason", () => {
    expect(resolveVerificationMessage("pending", false, { expired: true, reason: "no_match" })).toBe(
      "Este desafio expirou. Inicie uma nova verificação.",
    );
  });
});

describe("resolveVerificationUiState", () => {
  it("pending: mostra só o botão iniciar, sem challenge (cenário 1)", () => {
    expect(resolveVerificationUiState("pending", false, false)).toEqual({
      showStartButton: true,
      startLabel: "Iniciar verificação",
      showCheckButton: false,
      showChallenge: false,
    });
  });

  it("pending após expiração: rótulo muda para 'Iniciar nova verificação' (cenário 13)", () => {
    const state = resolveVerificationUiState("pending", false, true);
    expect(state.showStartButton).toBe(true);
    expect(state.startLabel).toBe("Iniciar nova verificação");
  });

  it("verifying com challenge visível: mostra o botão verificar e as instruções, esconde o iniciar", () => {
    expect(resolveVerificationUiState("verifying", true, false)).toEqual({
      showStartButton: false,
      startLabel: "Ver instruções de DNS",
      showCheckButton: true,
      showChallenge: true,
    });
  });

  it("verifying sem challenge visível: mostra só o botão para gerar novas instruções, nunca o de verificar", () => {
    const state = resolveVerificationUiState("verifying", false, false);
    expect(state.showStartButton).toBe(true);
    expect(state.showCheckButton).toBe(false);
    expect(state.showChallenge).toBe(false);
  });

  it("active: nunca mostra 'Iniciar verificação' automaticamente — só 'Verificar novamente', nunca o botão de checar (cenário 9)", () => {
    const state = resolveVerificationUiState("active", false, false);
    expect(state.showStartButton).toBe(true);
    expect(state.startLabel).toBe("Verificar novamente");
    expect(state.showCheckButton).toBe(false);
  });
});

describe("copyToClipboard", () => {
  it("copiar host: chama clipboard.writeText com o valor exato e retorna true (cenário 5)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const ok = await copyToClipboard({ writeText }, "_vexo-challenge.minhaloja.com.br");
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("_vexo-challenge.minhaloja.com.br");
  });

  it("copiar valor: chama clipboard.writeText com o token exato e retorna true (cenário 6)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const ok = await copyToClipboard({ writeText }, "a".repeat(32));
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("a".repeat(32));
  });

  it("clipboard indisponível: retorna false, nunca lança", async () => {
    await expect(copyToClipboard(undefined, "valor")).resolves.toBe(false);
    await expect(copyToClipboard(null, "valor")).resolves.toBe(false);
  });

  it("clipboard.writeText rejeita: retorna false, nunca lança (erro tratado amigavelmente)", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("permissão negada"));
    await expect(copyToClipboard({ writeText }, "valor")).resolves.toBe(false);
  });
});

describe("constantes de exibição do registro DNS", () => {
  it("tipo é sempre TXT", () => {
    expect(DNS_TXT_RECORD_TYPE).toBe("TXT");
  });

  it("TTL é 3600 (orientação visual — nenhuma convenção existente no projeto, ticket §5)", () => {
    expect(DNS_TXT_TTL_SECONDS).toBe(3600);
  });
});
