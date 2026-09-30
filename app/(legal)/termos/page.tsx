import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Termos de Uso — VEXO",
  description: "Condições de uso da plataforma VEXO.",
};

export default function TermsPage() {
  return (
    <article className="space-y-10">
      <header className="space-y-3 border-b border-outline-variant/20 pb-8">
        <p className="font-label text-label-md uppercase tracking-widest text-primary">Documento legal</p>
        <h1 className="font-display text-display-lg-mobile text-on-surface md:text-headline-lg">Termos de Uso</h1>
        <p className="font-body text-body-sm text-on-surface-variant">
          Última atualização: 30 de setembro de 2026.
        </p>
      </header>

      <LegalSection title="1. Sobre a VEXO">
        <p>
          A VEXO é uma plataforma para criação e gerenciamento de lojas virtuais. Ela oferece recursos de catálogo,
          pedidos, aparência, pagamentos, entrega e gestão operacional conforme o plano e as integrações habilitadas.
        </p>
      </LegalSection>

      <LegalSection title="2. Aceite e cadastro">
        <p>
          Ao criar uma conta ou utilizar a plataforma, você declara que leu e aceitou estes Termos e a Política de
          Privacidade. As informações cadastradas devem ser verdadeiras e atualizadas. Você é responsável por manter
          suas credenciais seguras e por toda atividade realizada na sua conta.
        </p>
      </LegalSection>

      <LegalSection title="3. Responsabilidade da loja">
        <p>
          Cada lojista é responsável pelos produtos, preços, estoque, conteúdo, atendimento, políticas comerciais,
          tributos e cumprimento das obrigações aplicáveis às suas vendas. A relação de compra e venda ocorre entre a
          loja e seu cliente; a VEXO fornece a infraestrutura tecnológica para apoiar essa operação.
        </p>
      </LegalSection>

      <LegalSection title="4. Integrações e serviços externos">
        <p>
          Alguns recursos dependem de serviços de terceiros, como meios de pagamento, frete, autenticação, hospedagem
          e envio de mensagens. A disponibilidade e as condições desses recursos também podem depender das regras do
          respectivo fornecedor. A VEXO não solicita que o lojista compartilhe senhas de serviços externos.
        </p>
      </LegalSection>

      <LegalSection title="5. Planos, teste e cobrança">
        <p>
          Recursos, limites, duração do período de teste e valores aplicáveis são apresentados na própria plataforma.
          Quando houver contratação paga, a cobrança seguirá as condições exibidas no momento da contratação. A falta
          de pagamento poderá limitar ou suspender o acesso aos recursos contratados.
        </p>
      </LegalSection>

      <LegalSection title="6. Uso permitido">
        <p>
          Não é permitido usar a plataforma para atividades ilegais, violar direitos de terceiros, distribuir código
          malicioso, tentar acessar contas ou dados sem autorização, contornar limites técnicos ou comprometer a
          segurança e a disponibilidade do serviço.
        </p>
      </LegalSection>

      <LegalSection title="7. Disponibilidade e alterações">
        <p>
          A plataforma pode receber correções, atualizações e mudanças de recursos. Interrupções podem ocorrer por
          manutenção, incidentes ou indisponibilidade de fornecedores. Alterações relevantes nestes Termos serão
          comunicadas pelos canais oficiais da plataforma quando exigido.
        </p>
      </LegalSection>

      <LegalSection title="8. Encerramento e contato">
        <p>
          Violações destes Termos podem resultar em limitação ou suspensão de acesso, observadas as circunstâncias do
          caso e a legislação aplicável. Dúvidas e solicitações devem ser encaminhadas pelos canais oficiais de
          atendimento disponibilizados na plataforma.
        </p>
      </LegalSection>
    </article>
  );
}

function LegalSection({ children, title }: Readonly<{ children: React.ReactNode; title: string }>) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-headline-sm text-on-surface">{title}</h2>
      <div className="font-body text-body-md leading-7 text-on-surface-variant">{children}</div>
    </section>
  );
}
