import { describe, expect, it } from "vitest";

import { computeSaveStatus, isCriticalSaveInProgress, saveButtonLabel, type SaveStatusInput } from "@/features/products/save-status";

/**
 * D20.9.1 — B1 (feedback incorreto de salvamento): "Produto salvo" só pode
 * aparecer depois que TODA a persistência staged (imagens D20.7 + opções/
 * valores/variantes D20.8) terminar, nunca só porque `createProductAction`
 * retornou sucesso. Cobre a auditoria de produção (§17 "UX/bugs
 * funcionais" B1/B2).
 */

const base: SaveStatusInput = {
  isEditMode: false,
  justCreated: false,
  gallerySettled: false,
  galleryHasFailure: false,
  configStatus: "idle",
};

describe("computeSaveStatus", () => {
  it("modo edição: sempre 'editing', mesmo com outros sinais indicando falha/pendência", () => {
    expect(computeSaveStatus({ ...base, isEditMode: true })).toBe("editing");
    expect(computeSaveStatus({ ...base, isEditMode: true, galleryHasFailure: true, configStatus: "error" })).toBe("editing");
  });

  it("produto ainda não criado (antes de clicar em Salvar): 'idle'", () => {
    expect(computeSaveStatus({ ...base, justCreated: false })).toBe("idle");
  });

  it("produto criado, imagens/config ainda não sinalizaram nada: 'persisting' (nunca 'done' prematuramente)", () => {
    expect(computeSaveStatus({ ...base, justCreated: true })).toBe("persisting");
  });

  it("produto criado, galeria sem imagens (settled logo, sem falha), config ainda pending: 'persisting'", () => {
    expect(
      computeSaveStatus({ ...base, justCreated: true, gallerySettled: true, galleryHasFailure: false, configStatus: "pending" }),
    ).toBe("persisting");
  });

  it("produto criado, config sem opções staged (success imediato), galeria ainda não settled: 'persisting'", () => {
    expect(computeSaveStatus({ ...base, justCreated: true, gallerySettled: false, configStatus: "success" })).toBe("persisting");
  });

  it("tudo settled sem falha (galeria + config): 'done' — só agora 'Produto salvo' é verdade", () => {
    expect(
      computeSaveStatus({ ...base, justCreated: true, gallerySettled: true, galleryHasFailure: false, configStatus: "success" }),
    ).toBe("done");
  });

  it("falha na galeria sozinha (config ainda success/idle): 'failed', nunca 'done'", () => {
    expect(
      computeSaveStatus({ ...base, justCreated: true, gallerySettled: true, galleryHasFailure: true, configStatus: "success" }),
    ).toBe("failed");
  });

  it("falha na persistência de opções/variantes sozinha (galeria ok): 'failed', nunca 'done'", () => {
    expect(
      computeSaveStatus({ ...base, justCreated: true, gallerySettled: true, galleryHasFailure: false, configStatus: "error" }),
    ).toBe("failed");
  });

  it("falha em ambos: 'failed'", () => {
    expect(computeSaveStatus({ ...base, justCreated: true, gallerySettled: true, galleryHasFailure: true, configStatus: "error" })).toBe(
      "failed",
    );
  });
});

describe("saveButtonLabel", () => {
  it("cobre as 5 rotulagens exatas exigidas pela Etapa 20.9.1", () => {
    expect(saveButtonLabel("idle")).toBe("Salvar produto");
    expect(saveButtonLabel("editing")).toBe("Salvar alterações");
    expect(saveButtonLabel("persisting")).toBe("Salvando produto…");
    expect(saveButtonLabel("failed")).toBe("Não foi possível concluir o salvamento");
    expect(saveButtonLabel("done")).toBe("Produto salvo");
  });
});

describe("isCriticalSaveInProgress", () => {
  it("só true durante 'persisting' — nunca durante 'failed' (o lojista precisa poder sair) nem 'done'/'idle'/'editing'", () => {
    expect(isCriticalSaveInProgress("persisting")).toBe(true);
    expect(isCriticalSaveInProgress("idle")).toBe(false);
    expect(isCriticalSaveInProgress("editing")).toBe(false);
    expect(isCriticalSaveInProgress("failed")).toBe(false);
    expect(isCriticalSaveInProgress("done")).toBe(false);
  });
});
