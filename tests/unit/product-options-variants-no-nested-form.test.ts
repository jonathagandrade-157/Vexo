import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * D20.6 Fase 3.3 — mesma guarda de regressão de
 * tests/unit/product-image-uploader-no-nested-form.test.ts (D11.7), agora
 * relevante porque esta fase passou a renderizar `ProductOptionsEditor` e
 * `VariantsTable` DENTRO do `<form>` de `ProductForm` pela primeira vez: um
 * `<form>` aninhado ali dentro é HTML inválido — o navegador descarta a tag
 * interna, e qualquer `requestSubmit()`/submit nativo dentro dela nunca
 * dispara a Server Action de verdade (mesmo incidente do D11.7, silencioso).
 * Sem jsdom/@testing-library/react neste projeto (vitest roda em
 * `environment: "node"`) — checagem estática do código-fonte, mesma técnica.
 */
describe("ProductOptionsEditor / VariantsTable não devem renderizar seu próprio <form>", () => {
  it.each(["../../components/painel/product-options-editor.tsx", "../../components/painel/variants-table.tsx"])(
    "%s nunca reintroduz um elemento <form> (evita form aninhado dentro de ProductForm)",
    (relativePath) => {
      const path = fileURLToPath(new URL(relativePath, import.meta.url));
      const source = readFileSync(path, "utf-8");
      const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(codeOnly).not.toMatch(/<form[\s>]/);
    },
  );
});
