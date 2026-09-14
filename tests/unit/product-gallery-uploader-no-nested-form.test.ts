import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * D20.7 — mesma guarda de regressão de
 * tests/unit/product-image-uploader-no-nested-form.test.ts (D11.7):
 * `ProductGalleryUploader` é renderizado dentro do `<form>` de
 * `ProductForm` — um `<form>` aninhado ali dentro é HTML inválido (o
 * navegador descarta a tag interna ao fazer o parsing). Relevante de novo
 * agora porque este componente foi reescrito por completo na Etapa 20.7
 * (seleção de imagens antes do primeiro save do produto) — continua
 * sendo só `<input type="file">`/`<button type="button">`, nunca um
 * `<form>` próprio. Sem jsdom/@testing-library/react neste projeto
 * (vitest roda em `environment: "node"`) — checagem estática do
 * código-fonte, mesma técnica.
 */
describe("ProductGalleryUploader não deve renderizar seu próprio <form>", () => {
  it("nunca reintroduz um elemento <form> (evita form aninhado dentro de ProductForm)", () => {
    const path = fileURLToPath(new URL("../../components/painel/product-gallery-uploader.tsx", import.meta.url));
    const source = readFileSync(path, "utf-8");
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(codeOnly).not.toMatch(/<form[\s>]/);
  });
});
