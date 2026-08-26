/**
 * Itens de navegação do painel — extraídos de `vexo_dashboard_principal_*`
 * (Stitch), mesmos ícones/rótulos/ordem. `implemented: false` marca as
 * seções que pertencem a etapas futuras (clientes, marketing, IA,
 * suporte) — a rota existe de verdade e renderiza um estado "disponível
 * em breve" (`ComingSoon`), nunca um link morto (arquitetura §8 Etapa
 * 5: "não possuir botão sem ação"). Pedidos passou a `true` na Etapa 13.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: string;
  implemented: boolean;
  /**
   * Etapa 16 §4 — chave de `features.key` (Etapa 14) que controla este
   * item por plano. Só preenchida quando existe uma feature real
   * correspondente já cadastrada (prompt §16: "não inventar
   * funcionalidades que ainda não existem") — "Marketing" não tem uma
   * feature própria no catálogo hoje, então fica sem essa checagem, como
   * sempre esteve.
   */
  featureKey?: string;
}

export const MAIN_NAV_ITEMS: NavItem[] = [
  { href: "/painel", label: "Início", icon: "dashboard", implemented: true },
  { href: "/painel/pedidos", label: "Pedidos", icon: "shopping_cart", implemented: true },
  { href: "/painel/produtos", label: "Produtos", icon: "inventory_2", implemented: true },
  { href: "/painel/clientes", label: "Clientes", icon: "group", implemented: false, featureKey: "customers" },
  { href: "/painel/marketing", label: "Marketing", icon: "campaign", implemented: false },
  { href: "/painel/aparencia", label: "Aparência", icon: "palette", implemented: true },
  { href: "/painel/configuracoes", label: "Configurações", icon: "settings", implemented: true },
];

/**
 * Bottom nav do mobile — só os 4 itens que o Stitch mostra nessa largura
 * (`vexo_dashboard_principal_mobile`), não a lista inteira do sidebar.
 * Sprint 1 — Fase B3: referenciados por `href` (não por posição em
 * `MAIN_NAV_ITEMS`) — a inserção de "Aparência" deslocou os índices, e um
 * lookup por posição quebraria de novo na próxima reordenação.
 */
export const MOBILE_NAV_ITEMS: NavItem[] = ["/painel", "/painel/pedidos", "/painel/produtos", "/painel/configuracoes"].map(
  (href) => MAIN_NAV_ITEMS.find((item) => item.href === href)!,
);

export const AI_SPARK_ITEM: NavItem = {
  href: "/painel/vexo-ai",
  label: "Vexo AI Spark",
  icon: "auto_awesome",
  implemented: false,
  featureKey: "vexo_ai",
};

export const SUPPORT_ITEM: NavItem = {
  href: "/painel/suporte",
  label: "Suporte",
  icon: "help",
  implemented: false,
};
