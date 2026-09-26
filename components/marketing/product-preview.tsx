const PRODUCTS = [
  { color: "bg-[#d9c9b8]", name: "Bolsa Alba", price: "R$ 189" },
  { color: "bg-[#b9c5b3]", name: "Carteira Lina", price: "R$ 89" },
];

/**
 * Demonstra as duas superfícies que a VEXO entrega sem depender de dados,
 * imagens ou contas de demonstração: a operação do lojista e a vitrine que
 * o cliente final acessa. É intencionalmente estático — funciona no HTML
 * inicial da landing e não adiciona JavaScript só para trocar mockups.
 */
export function ProductPreview() {
  return (
    <div
      aria-label="Exemplo do painel do lojista e da loja vista pelo cliente"
      className="overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest shadow-2xl shadow-on-surface/5"
    >
      <div className="flex items-center justify-between border-b border-outline-variant/30 px-4 py-3 sm:px-5">
        <div aria-hidden="true" className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-error/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-tertiary/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-primary/60" />
        </div>
        <span className="font-label text-[10px] uppercase tracking-[0.16em] text-on-surface-variant sm:text-label-sm">
          Sua operação e sua vitrine
        </span>
      </div>

      <div className="grid gap-3 p-3 sm:grid-cols-[1.25fr_0.75fr] sm:p-4">
        <section className="overflow-hidden rounded-lg border border-outline-variant/30 bg-surface" aria-label="Painel do lojista">
          <div className="flex items-center justify-between border-b border-outline-variant/30 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-primary">space_dashboard</span>
              <span className="font-display text-xs font-semibold text-on-surface sm:text-sm">Painel do lojista</span>
            </div>
            <span className="rounded-full bg-primary-container/10 px-2 py-1 font-label text-[9px] uppercase tracking-wider text-primary">
              Loja ativa
            </span>
          </div>

          <div className="space-y-3 p-3 sm:p-4">
            <div>
              <p className="font-body text-[10px] text-on-surface-variant">Visão geral</p>
              <p className="font-display text-sm font-semibold text-on-surface">Ateliê Aurora</p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                ["inventory_2", "Produtos", "Catálogo"],
                ["receipt_long", "Pedidos", "Acompanhar"],
                ["palette", "Aparência", "Personalizar"],
              ].map(([icon, label, action]) => (
                <div className="rounded-md border border-outline-variant/25 bg-surface-container-lowest p-2" key={label}>
                  <span className="material-symbols-outlined text-[15px] text-primary">{icon}</span>
                  <p className="mt-2 truncate font-display text-[10px] font-semibold text-on-surface">{label}</p>
                  <p className="truncate font-body text-[8px] text-on-surface-variant">{action}</p>
                </div>
              ))}
            </div>

            <div className="rounded-md border border-outline-variant/25 bg-surface-container-lowest">
              <div className="flex items-center justify-between border-b border-outline-variant/20 px-3 py-2">
                <span className="font-label text-[10px] font-semibold text-on-surface">Configure sua loja</span>
                <span className="font-body text-[9px] text-on-surface-variant">2 de 3</span>
              </div>
              {[
                ["check_circle", "Dados da loja", "Concluído"],
                ["check_circle", "Identidade visual", "Concluído"],
                ["radio_button_unchecked", "Primeiro produto", "Próximo passo"],
              ].map(([icon, label, status]) => (
                <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 px-3 py-1.5" key={label}>
                  <span className="material-symbols-outlined text-[13px] text-primary">{icon}</span>
                  <span className="truncate font-body text-[9px] text-on-surface">{label}</span>
                  <span className="font-label text-[8px] text-on-surface-variant">{status}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          aria-label="Loja vista pelo cliente"
          className="overflow-hidden rounded-lg border border-[#ded8cf] bg-[#fbfaf7] text-[#18171a] shadow-lg shadow-on-surface/5"
        >
          <div className="flex items-center justify-between border-b border-[#e8e2d9] px-3 py-3">
            <div>
              <p className="font-label text-[8px] uppercase tracking-[0.15em] text-[#756d64]">Visão do cliente</p>
              <p className="font-display text-xs font-semibold tracking-[0.12em]">AURORA</p>
            </div>
            <span className="material-symbols-outlined text-[17px]">shopping_bag</span>
          </div>

          <div className="m-3 rounded-md bg-[#3f315b] p-3 text-white">
            <p className="font-label text-[8px] uppercase tracking-[0.14em] text-white/70">Nova coleção</p>
            <p className="mt-1 font-display text-sm font-semibold leading-tight">Feito à mão para acompanhar você.</p>
            <span className="mt-3 inline-flex rounded-full bg-white px-2 py-1 font-label text-[8px] text-[#3f315b]">
              Ver produtos
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 px-3 pb-3">
            {PRODUCTS.map((product) => (
              <div key={product.name}>
                <div className={`aspect-[4/5] rounded-md ${product.color}`}>
                  <div className="flex h-full items-end justify-end p-1.5">
                    <span className="material-symbols-outlined rounded-full bg-white/90 p-1 text-[12px]">add</span>
                  </div>
                </div>
                <p className="mt-1.5 truncate font-body text-[9px] text-[#4d4741]">{product.name}</p>
                <p className="font-label text-[9px] font-semibold">{product.price}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-2 border-t border-outline-variant/30 bg-surface-container-low">
        <div className="flex items-center gap-2 border-r border-outline-variant/30 px-3 py-2.5 sm:px-4">
          <span className="material-symbols-outlined text-[16px] text-primary">tune</span>
          <span className="font-body text-[9px] text-on-surface-variant sm:text-[10px]">Você configura pelo painel</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2.5 sm:px-4">
          <span className="material-symbols-outlined text-[16px] text-primary">storefront</span>
          <span className="font-body text-[9px] text-on-surface-variant sm:text-[10px]">Seu cliente compra na loja</span>
        </div>
      </div>
    </div>
  );
}
