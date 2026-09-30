import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade — VEXO",
  description: "Como a VEXO trata dados pessoais na plataforma.",
};

export default function PrivacyPage() {
  return (
    <article className="space-y-10">
      <header className="space-y-3 border-b border-outline-variant/20 pb-8">
        <p className="font-label text-label-md uppercase tracking-widest text-primary">Documento legal</p>
        <h1 className="font-display text-display-lg-mobile text-on-surface md:text-headline-lg">
          Política de Privacidade
        </h1>
        <p className="font-body text-body-sm text-on-surface-variant">
          Última atualização: 30 de setembro de 2026.
        </p>
      </header>

      <LegalSection title="1. Quais dados tratamos">
        <p>
          Podemos tratar dados de cadastro, como nome, e-mail, telefone e documento de identificação; dados da loja e
          da operação; informações de pedidos; registros técnicos, de segurança e de uso; além dos dados que clientes
          finais informam ao concluir um pedido em uma loja publicada pela VEXO.
        </p>
        <p>
          O CPF ou CNPJ informado no cadastro é validado e transformado em um identificador criptográfico para o
          controle de elegibilidade do período de teste, sem armazenamento do documento em texto legível nesse fluxo.
        </p>
      </LegalSection>

      <LegalSection title="2. Para que usamos os dados">
        <p>
          Usamos os dados para criar e proteger contas, prestar as funcionalidades contratadas, processar pedidos,
          habilitar integrações, prestar suporte, prevenir fraude e abuso, melhorar a estabilidade do produto e
          cumprir obrigações legais. O tratamento ocorre conforme a execução do serviço, interesses legítimos de
          segurança e melhoria, cumprimento de obrigações e, quando aplicável, consentimento.
        </p>
      </LegalSection>

      <LegalSection title="3. Lojistas e clientes finais">
        <p>
          Para os dados inseridos pelos clientes finais em uma loja, o lojista define a finalidade comercial e é o
          principal responsável pelo relacionamento com esses clientes. A VEXO trata esses dados para operar a
          plataforma e executar as instruções necessárias ao funcionamento da loja.
        </p>
      </LegalSection>

      <LegalSection title="4. Compartilhamento e fornecedores">
        <p>
          Dados podem ser processados por fornecedores de infraestrutura, autenticação, monitoramento, comunicação,
          cobrança, pagamentos e logística quando isso for necessário ao recurso utilizado. Também poderemos
          compartilhar informações para cumprir uma obrigação legal, proteger direitos ou responder a uma autoridade
          competente. Não vendemos dados pessoais.
        </p>
      </LegalSection>

      <LegalSection title="5. Segurança e retenção">
        <p>
          Aplicamos controles de acesso, isolamento entre lojas e medidas técnicas para reduzir riscos de acesso,
          alteração ou divulgação indevida. Nenhum sistema é imune a incidentes. Os dados são mantidos pelo período
          necessário à prestação do serviço, à segurança da operação e ao cumprimento de obrigações aplicáveis.
        </p>
      </LegalSection>

      <LegalSection title="6. Cookies e preferências locais">
        <p>
          A plataforma utiliza tecnologias necessárias para autenticação, segurança e funcionamento da sessão. Também
          pode armazenar preferências no dispositivo, como a escolha de tema claro ou escuro. Recursos de terceiros
          podem usar mecanismos próprios conforme suas políticas.
        </p>
      </LegalSection>

      <LegalSection title="7. Seus direitos">
        <p>
          Conforme a legislação aplicável, você pode solicitar confirmação de tratamento, acesso, correção,
          portabilidade, informação sobre compartilhamento, oposição ou eliminação quando cabível. A identidade do
          solicitante poderá ser verificada para proteger a conta e os dados envolvidos.
        </p>
      </LegalSection>

      <LegalSection title="8. Contato e atualizações">
        <p>
          Solicitações de privacidade devem ser encaminhadas pelos canais oficiais de atendimento disponibilizados na
          plataforma. Esta Política pode ser atualizada para refletir mudanças no produto ou na legislação; alterações
          relevantes serão comunicadas quando necessário.
        </p>
      </LegalSection>
    </article>
  );
}

function LegalSection({ children, title }: Readonly<{ children: React.ReactNode; title: string }>) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-headline-sm text-on-surface">{title}</h2>
      <div className="space-y-3 font-body text-body-md leading-7 text-on-surface-variant">{children}</div>
    </section>
  );
}
