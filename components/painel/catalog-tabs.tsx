import Link from "next/link";

/**
 * Sub-navegação de Produtos/Categorias — não é um item novo no sidebar
 * principal: `vexo_categorias_desktop` (Stitch) mantém "Produtos"
 * destacado no sidebar mesmo na tela de categorias, ou seja, categorias é
 * uma sub-seção de Produtos na própria navegação do design, não uma
 * seção irmã. Server Component simples (só precisa saber a aba ativa,
 * recebida como prop pela própria rota).
 */
export function CatalogTabs({ active }: { active: "produtos" | "categorias" }) {
  const tabs = [
    { key: "produtos" as const, label: "Produtos", href: "/painel/produtos" },
    { key: "categorias" as const, label: "Categorias", href: "/painel/categorias" },
  ];

  return (
    <div className="flex gap-1 border-b border-outline-variant">
      {tabs.map((tab) => (
        <Link
          className={
            tab.key === active
              ? "border-b-2 border-primary px-4 py-3 font-label text-label-md text-primary"
              : "border-b-2 border-transparent px-4 py-3 font-label text-label-md text-on-surface-variant transition-colors hover:text-on-surface"
          }
          href={tab.href}
          key={tab.key}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
