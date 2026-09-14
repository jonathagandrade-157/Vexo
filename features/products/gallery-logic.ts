/**
 * D13.1 — lógica pura de reordenação da galeria (sem `supabase`, sem
 * I/O) — testável sem banco, mesmo princípio já usado em
 * `image-storage.ts` (D11.2/D11.8) e `features/onboarding/progress-logic.ts`
 * (D12.2). Server Actions (`features/products/actions.ts`) só orquestram
 * I/O em cima destas funções — nunca decidem "essa reordenação é válida?"
 * inline.
 */

/**
 * Um pedido de reorder só é aceito se for EXATAMENTE uma permutação do
 * conjunto de ids que já pertencem ao produto (mesmo tamanho, mesmos
 * ids, sem duplicata) — nunca um id de outro produto/tenant "inserido"
 * no meio, nunca uma imagem existente "esquecida" (que ficaria com
 * sort_order indefinido). `currentIds` sempre vem de uma query já
 * escopada por tenant_id + product_id (nunca confiado do cliente) —
 * esta função só compara os dois conjuntos.
 */
export function isValidGalleryReorder(currentIds: readonly string[], requestedOrder: readonly string[]): boolean {
  if (currentIds.length !== requestedOrder.length) return false;

  const requestedSet = new Set(requestedOrder);
  if (requestedSet.size !== requestedOrder.length) return false; // duplicata no pedido

  const currentSet = new Set(currentIds);
  if (currentSet.size !== currentIds.length) return false; // defensivo — nunca deveria acontecer vindo do banco

  for (const id of requestedOrder) {
    if (!currentSet.has(id)) return false;
  }
  for (const id of currentSet) {
    if (!requestedSet.has(id)) return false;
  }
  return true;
}

export interface GallerySortAssignment {
  id: string;
  sortOrder: number;
}

/** A posição no array é a única fonte de `sort_order` — nunca um valor enviado pelo cliente junto de cada id. */
export function computeGallerySortOrder(orderedIds: readonly string[]): GallerySortAssignment[] {
  return orderedIds.map((id, index) => ({ id, sortOrder: index }));
}

/**
 * "Definir como principal" = mover `targetId` para o início da lista,
 * preservando a ordem relativa das demais — nunca uma coluna
 * `is_primary` própria (D13.1 §9: "imagem principal" é sempre a de
 * `sort_order` mínimo). `null` quando `targetId` não pertence à galeria
 * atual (mesma defesa de `isValidGalleryReorder`).
 */
export function moveImageToFront(currentIds: readonly string[], targetId: string): string[] | null {
  if (!currentIds.includes(targetId)) return null;
  return [targetId, ...currentIds.filter((id) => id !== targetId)];
}

/**
 * D20.7 — move um item uma posição para a esquerda/direita dentro do
 * array, preservando a ordem relativa dos demais. `null` quando o id não
 * existe ou já está no limite (nada a mover) — mesmo formato de retorno
 * de `moveImageToFront`. Genérica sobre `string[]`, reaproveitada pelo
 * reorder por botões ←→ de imagens ainda não enviadas ao Storage
 * (`ProductGalleryUploader`, seleção antes do primeiro save do produto).
 */
export function moveArrayItem(currentIds: readonly string[], targetId: string, direction: -1 | 1): string[] | null {
  const index = currentIds.indexOf(targetId);
  const targetIndex = index + direction;
  if (index === -1 || targetIndex < 0 || targetIndex >= currentIds.length) return null;
  const next = [...currentIds];
  const [moved] = next.splice(index, 1);
  next.splice(targetIndex, 0, moved!);
  return next;
}

/**
 * D20.7 — quantos arquivos de uma seleção múltipla cabem no limite da
 * galeria, dado o que já existe (imagens já persistidas + já
 * selecionadas/ainda não enviadas). Pura — usada por
 * `ProductGalleryUploader` antes de sequer tentar estagiar qualquer
 * arquivo além do limite.
 */
export function acceptableFileCount(currentCount: number, requestedCount: number, maxImages: number): number {
  const remaining = Math.max(0, maxImages - currentCount);
  return Math.min(remaining, Math.max(0, requestedCount));
}

export interface StagedUploadStep {
  id: string;
  /**
   * `true` só para o primeiro item desta rodada, e só quando a galeria
   * ainda não tem NENHUMA imagem persistida — mesma regra de sempre
   * (principal = primeira da fila real, sort_order 0). Se o item marcado
   * como tal falhar, quem consome este plano (`ProductGalleryUploader`)
   * NUNCA deve tentar os seguintes desta rodada: um arquivo diferente do
   * pretendido nunca pode virar "principal" silenciosamente (D20.7 Fase
   * 4 §8) — os demais continuam pendentes, disponíveis para nova
   * tentativa quando o problema do principal for resolvido.
   */
  isIntendedPrimary: boolean;
}

/**
 * D20.7 — decide, para uma rodada de envio de arquivos ainda não
 * enviados, a ordem de tentativa e qual deles é o "principal" pretendido
 * — pura, sem I/O, testável sem o componente React que a consome. Nunca
 * decide o que fazer com uma falha em si (isso só se sabe em tempo de
 * execução, ao chamar de fato `prepareProductGalleryImageUploadAction`/
 * `confirmProductGalleryImageUploadAction`) — só o plano inicial.
 */
export function planStagedUpload(itemIds: readonly string[], hasExistingImages: boolean): StagedUploadStep[] {
  return itemIds.map((id, index) => ({ id, isIntendedPrimary: !hasExistingImages && index === 0 }));
}
