/**
 * Shared between the desktop nav and the mobile drawer. "Depoimentos" was
 * dropped on purpose — the brief forbids inventing testimonials, and
 * there's no real one to link to yet, so there's no matching section.
 */
export const NAV_LINKS = [
  { href: "#hero", label: "Início" },
  { href: "#sobre", label: "A Clínica" },
  { href: "#tratamentos", label: "Tratamentos" },
  { href: "#resultados", label: "Resultados" },
  { href: "#localizacao", label: "Localização" },
  { href: "#contato", label: "Contato" },
] as const;
