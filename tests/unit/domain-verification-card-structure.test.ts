import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * D17.3.3 — `DomainVerificationCard` (`components/painel/domain-verification-card.tsx`)
 * é um Client Component com estado/loading/clipboard: o comportamento de
 * DOM de verdade (clique desabilita botão, clique dispara a Server Action)
 * não pode ser exercitado neste projeto porque `vitest.config.ts` roda com
 * `environment: "node"`, sem jsdom nem `@testing-library/react` — mesma
 * limitação já registrada e resolvida do mesmo jeito em
 * `tests/unit/product-image-uploader-no-nested-form.test.ts` (D11.7):
 * checagem estática do código-fonte em vez de um render real. A lógica que
 * PODE ser testada de verdade (mensagens, visibilidade dos botões, cópia
 * para clipboard) está em `tests/unit/domain-verification-messages.test.ts`,
 * contra o módulo puro `features/settings/domain-verification-messages.ts`.
 *
 * Este arquivo cobre só os cenários do ticket D17.3.3 §18 que são
 * inerentemente sobre a fiação do componente com o DOM/Server Actions
 * (2, 7, 8, 14), como uma checagem de regressão — não substitui um teste de
 * render real, e o relatório desta etapa deixa essa limitação explícita.
 */

function readComponentSource(): string {
  const path = fileURLToPath(new URL("../../components/painel/domain-verification-card.tsx", import.meta.url));
  return readFileSync(path, "utf-8");
}

describe("DomainVerificationCard — fiação com Server Actions e loading (regressão estática)", () => {
  it("chama startDomainVerification(domain.id) — nunca com um id vindo de outro lugar (cenário 2)", () => {
    const source = readComponentSource();
    expect(source).toMatch(/startDomainVerification\(domain\.id\)/);
  });

  it("chama checkDomainVerification(domain.id) ao clicar em 'Verificar domínio' (cenário 7)", () => {
    const source = readComponentSource();
    expect(source).toMatch(/checkDomainVerification\(domain\.id\)/);
  });

  it("o botão de iniciar fica desabilitado enquanto qualquer transição está pendente (cenário 8)", () => {
    const source = readComponentSource();
    // `busy = isStarting || isChecking` e ambos os botões usam `disabled={busy}` —
    // evita clique duplo tanto durante o start quanto durante o check.
    expect(source).toMatch(/const busy = isStarting \|\| isChecking/);
    const startButtonBlock = source.split("uiState.showStartButton ?")[1] ?? "";
    const checkButtonBlock = source.split("uiState.showCheckButton ?")[1] ?? "";
    expect(startButtonBlock.slice(0, 400)).toMatch(/disabled=\{busy\}/);
    expect(checkButtonBlock.slice(0, 400)).toMatch(/disabled=\{busy\}/);
  });

  it("nunca referencia o hash do challenge (verification_token_hash) — o único segredo em texto puro que chega à UI é o token retornado por startDomainVerification (cenário 14)", () => {
    const source = readComponentSource();
    expect(source).not.toMatch(/verification_token_hash/i);
    expect(source).not.toMatch(/tokenHash/i);
  });

  it("nunca consulta DNS diretamente no browser (nem node:dns, nem fetch/axios para um resolver externo) — a Action é sempre o único caminho (ticket §7)", () => {
    const source = readComponentSource();
    expect(source).not.toMatch(/node:dns/);
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\baxios\b/);
  });

  it("é um Client Component ('use client'), nunca move resolução de tenant para o browser (domainId é o único dado enviado à Action)", () => {
    const source = readComponentSource();
    expect(source.trimStart().startsWith('"use client";')).toBe(true);
    expect(source).not.toMatch(/tenantId/);
  });
});

describe("CheckDomainVerificationResult — contrato nunca expõe o hash/token internos (cenário 14)", () => {
  it("a interface do retorno de checkDomainVerification não declara nenhum campo de hash/token", () => {
    const path = fileURLToPath(new URL("../../features/settings/domain-verification-actions.ts", import.meta.url));
    const source = readFileSync(path, "utf-8");
    const interfaceBlock = source.slice(
      source.indexOf("export interface CheckDomainVerificationResult"),
      source.indexOf("export interface CheckDomainVerificationResult") + 800,
    );
    const body = interfaceBlock.slice(0, interfaceBlock.indexOf("\n}"));
    expect(body).not.toMatch(/token/i);
  });
});
