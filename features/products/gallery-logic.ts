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
