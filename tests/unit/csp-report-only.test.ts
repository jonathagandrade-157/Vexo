import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("CSP report-only", () => {
  it("não envia upgrade-insecure-requests, ignorado nesse modo pelos navegadores", () => {
    const source = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
    const cspTemplate = source.match(/const csp = `([\s\S]*?)`;/)?.[1];

    expect(cspTemplate).toBeDefined();
    expect(cspTemplate).not.toContain("upgrade-insecure-requests");
  });
});
