import { describe, expect, it } from "vitest";

import {
  isRegisterAction,
  resolveVercelPrimaryActionLabel,
  resolveVercelStatusLabel,
  resolveVercelStatusMessage,
} from "@/features/settings/domain-vercel-messages";
import type { VercelDomainStatus } from "@/features/settings/domain-vercel-actions";

const ALL_STATUSES: VercelDomainStatus[] = [
  "not_registered",
  "registering",
  "registered",
  "configuration_error",
  "certificate_error",
  "unknown",
];

describe("domain-vercel-messages", () => {
  it("todo estado tem um label e uma mensagem não vazios (nunca undefined em runtime)", () => {
    for (const status of ALL_STATUSES) {
      expect(resolveVercelStatusLabel(status).length).toBeGreaterThan(0);
      expect(resolveVercelStatusMessage(status).length).toBeGreaterThan(0);
    }
  });

  it("registered tem mensagem de sucesso, sem instrução de DNS", () => {
    expect(resolveVercelStatusMessage("registered")).toBe("Domínio conectado e funcionando.");
  });

  it("configuration_error orienta a corrigir o DNS", () => {
    expect(resolveVercelStatusMessage("configuration_error")).toMatch(/DNS/);
  });

  it("nenhuma mensagem expõe token/Authorization/detalhe interno", () => {
    for (const status of ALL_STATUSES) {
      const message = resolveVercelStatusMessage(status);
      expect(message).not.toMatch(/token|authorization|vca_|api\.vercel\.com|stack/i);
    }
  });

  it("isRegisterAction: só not_registered aciona o registro", () => {
    expect(isRegisterAction("not_registered")).toBe(true);
    for (const status of ALL_STATUSES.filter((s) => s !== "not_registered")) {
      expect(isRegisterAction(status)).toBe(false);
    }
  });

  it("resolveVercelPrimaryActionLabel: rótulo muda entre conectar e verificar novamente", () => {
    expect(resolveVercelPrimaryActionLabel("not_registered")).toBe("Conectar à Vercel");
    for (const status of ALL_STATUSES.filter((s) => s !== "not_registered")) {
      expect(resolveVercelPrimaryActionLabel(status)).toBe("Verificar novamente");
    }
  });
});
