/** Mesmo critério de private.mask_account_id() (SQL) — nunca exibir o identificador da conta conectada por inteiro, mesmo não sendo um segredo (arquitetura §11.1). */
export function maskAccountId(value: string | null): string {
  if (!value) return "—";
  if (value.length <= 4) return "*".repeat(value.length);
  return "*".repeat(value.length - 4) + value.slice(-4);
}
