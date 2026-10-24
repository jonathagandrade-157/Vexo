import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("checkout — complemento opcional", () => {
  it("não marca o campo complemento como obrigatório no HTML", () => {
    const source = readFileSync(join(process.cwd(), "components/storefront/checkout-form.tsx"), "utf8");
    const complementField = source.match(
      /<TextField[\s\S]*?id="complement"[\s\S]*?label="Complemento \(opcional\)"[\s\S]*?\/>/,
    );

    expect(complementField?.[0]).toContain("required={false}");
  });
});
