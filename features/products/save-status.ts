/**
 * D20.9.1 — deriva o estado de salvamento visível ao lojista a partir dos
 * sinais assíncronos que juntos compõem "o produto terminou de ser salvo
 * de verdade": só `createProductAction` retornar sucesso (`justCreated`,
 * via `useActionState`/`useFormStatus`) NÃO é o suficiente — ela só cria a
 * linha do produto; o upload de imagens (Etapa 20.7) e a persistência de
 * opções/valores/variantes staged (Etapa 20.8, `persist-staged-
 * configuration.ts`, não alterado por esta etapa) continuam rodando
 * DEPOIS que ela retorna. Antes da Etapa 20.9.1, `ProductForm` mostrava
 * "Produto salvo" assim que `justCreated` ficava true, sem esperar essas
 * duas outras persistências — um falso sucesso (auditoria B1).
 *
 * Pura, sem I/O — `ProductForm` só orquestra em cima disto, nunca decide
 * inline (mesmo princípio de gallery-logic.ts/variant-combinations.ts/
 * staged-options-logic.ts).
 */
export type SaveStatus = "idle" | "editing" | "persisting" | "failed" | "done";

export interface SaveStatusInput {
  /** true quando `product` foi passado a ProductForm (modo edição) — o resto deste módulo nunca se aplica (edição não passa por staging). */
  isEditMode: boolean;
  /** true assim que `createProductAction` devolveu sucesso — a partir daqui existe um productId real e o upload de imagens/persistência de opções pode começar. */
  justCreated: boolean;
  /** true assim que ProductGalleryUploader terminou (com sucesso ou falha) pelo menos uma rodada de envio dos arquivos pendentes — `false` significa "ainda não sabemos", nunca "sem falha". */
  gallerySettled: boolean;
  galleryHasFailure: boolean;
  configStatus: "idle" | "pending" | "success" | "error";
}

export function computeSaveStatus(input: SaveStatusInput): SaveStatus {
  if (input.isEditMode) return "editing";
  if (!input.justCreated) return "idle";
  if (input.galleryHasFailure || input.configStatus === "error") return "failed";
  if (input.gallerySettled && input.configStatus === "success") return "done";
  return "persisting";
}

export function saveButtonLabel(status: SaveStatus): string {
  switch (status) {
    case "editing":
      return "Salvar alterações";
    case "done":
      return "Produto salvo";
    case "failed":
      return "Não foi possível concluir o salvamento";
    case "persisting":
      return "Salvando produto…";
    case "idle":
    default:
      return "Salvar produto";
  }
}

/**
 * true só enquanto existe uma operação crítica de salvamento em andamento
 * (produto já criado, mas imagens/opções/variantes ainda persistindo, sem
 * nenhuma falha) — usado para bloquear/confirmar navegação (Etapa 20.9.1,
 * B2). Nunca true em "failed" (o lojista precisa poder sair e voltar
 * depois sem ficar preso) nem em "done" (já terminou).
 */
export function isCriticalSaveInProgress(status: SaveStatus): boolean {
  return status === "persisting";
}
