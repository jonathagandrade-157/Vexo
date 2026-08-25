/**
 * Navegação do Painel MASTER (prompt Etapa 14 §14) — rota separada do
 * painel do lojista, mesmo princípio de `implemented: false` já usado em
 * `components/painel/nav-items.ts` (Etapa 5): toda rota listada aqui
 * existe de verdade, as não implementadas mostram `ComingSoon`, nunca um
 * link morto. `/master`, `/master/planos`, `/master/recursos` (Etapa 14)
 * e `/master/lojas` (Etapa 18) já têm funcionalidade real — as demais
 * seguem `ComingSoon` (prompt §14: "não precisa implementar todas as
 * páginas completamente").
 */
export interface MasterNavItem {
  href: string;
  label: string;
  icon: string;
  implemented: boolean;
}

export const MASTER_NAV_ITEMS: MasterNavItem[] = [
  { href: "/master", label: "Dashboard", icon: "space_dashboard", implemented: true },
  { href: "/master/clientes", label: "Clientes", icon: "group", implemented: false },
  { href: "/master/lojas", label: "Lojas", icon: "storefront", implemented: true },
  { href: "/master/planos", label: "Planos", icon: "workspace_premium", implemented: true },
  { href: "/master/recursos", label: "Recursos", icon: "toggle_on", implemented: true },
  { href: "/master/assinaturas", label: "Assinaturas", icon: "receipt_long", implemented: false },
  { href: "/master/trials", label: "Trials", icon: "hourglass_top", implemented: false },
  { href: "/master/configuracoes", label: "Configurações", icon: "settings", implemented: false },
];
