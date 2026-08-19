/**
 * Turns a store name into a URL/identifier-safe slug matching the
 * `tenants_slug_format` CHECK constraint from Etapa 2
 * (`^[a-z0-9]+(-[a-z0-9]+)*$`, migration 20260817220004_tenants.sql) —
 * lowercase, accents stripped, runs of non-alphanumerics collapsed to a
 * single hyphen, no leading/trailing hyphen.
 */
export function slugify(input: string): string {
  const base = input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents left by NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.length > 0 ? base : "loja";
}

/** Appends a short random suffix — used to retry once after a slug collision. */
export function slugifyWithSuffix(input: string): string {
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${slugify(input)}-${suffix}`;
}
