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
}

export const MAIN_NAV_ITEMS: NavItem[] = [
  { href: "/painel", label: "Início", icon: "dashboard", implemented: true },
  { href: "/painel/pedidos", label: "Pedidos", icon: "shopping_cart", implemented: true },
  { href: "/painel/produtos", label: "Produtos", icon: "inventory_2", implemented: true },
  { href: "/painel/clientes", label: "Clientes", icon: "group", implemented: false },
  { href: "/painel/marketing", label: "Marketing", icon: "campaign", implemented: false },
  { href: "/painel/configuracoes", label: "Configurações", icon: "settings", implemented: true },
];

/** Bottom nav do mobile — só os 4 itens que o Stitch mostra nessa largura (`vexo_dashboard_principal_mobile`), não a lista inteira do sidebar. */
export const MOBILE_NAV_ITEMS: NavItem[] = [
  MAIN_NAV_ITEMS[0]!,
  MAIN_NAV_ITEMS[1]!,
  MAIN_NAV_ITEMS[2]!,
  MAIN_NAV_ITEMS[5]!,
];

export const AI_SPARK_ITEM: NavItem = {
  href: "/painel/vexo-ai",
  label: "Vexo AI Spark",
  icon: "auto_awesome",
  implemented: false,
};

export const SUPPORT_ITEM: NavItem = {
  href: "/painel/suporte",
  label: "Suporte",
  icon: "help",
  implemented: false,
};
