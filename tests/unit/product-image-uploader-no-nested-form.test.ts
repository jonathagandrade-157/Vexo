import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * D11.7 — guarda de regressão para a causa raiz confirmada: `ProductImageUploader`
 * é sempre renderizado dentro do `<form>` de `ProductForm` (nome/preço/categoria)
 * — um segundo `<form>` aninhado ali dentro é HTML inválido; o navegador descarta
 * a tag interna ao fazer o parsing, então `requestSubmit()`/o próprio elemento de
 * formulário nunca dispara `uploadProductImageAction` de verdade (o upload nunca
 * chega ao Storage, silenciosamente).
 *
 * Não é possível testar isso renderizando o DOM de verdade: este projeto roda o
 * vitest em `environment: "node"` (`vitest.config.ts`), sem jsdom nem
 * @testing-library/react — a mesma limitação já registrada em
 * `product-image-storage.test.ts` (D11.2). Em vez de pular a checagem, este teste
 * lê o código-fonte e garante estaticamente que nenhuma tag `<form` volta a
 * aparecer neste arquivo — o suficiente para pegar a regressão exata que causou
 * o incidente, mesmo sem infraestrutura de render.
 */
describe("ProductImageUploader não deve renderizar seu próprio <form>", () => {
  it("nunca reintroduz um elemento <form> (evita form aninhado dentro de ProductForm)", () => {
    const path = fileURLToPath(new URL("../../components/painel/product-image-uploader.tsx", import.meta.url));
    const source = readFileSync(path, "utf-8");
    // Remove comentários de bloco/linha antes de checar: os próprios
    // comentários deste arquivo mencionam `<form>` em prosa (explicando a
    // causa raiz do D11.7) — sem isso o teste dispararia um falso positivo
    // contra a própria documentação do bug que ele existe para prevenir.
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(codeOnly).not.toMatch(/<form[\s>]/);
  });
});
