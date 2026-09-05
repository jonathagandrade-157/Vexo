import type { VercelDomainStatus } from "./domain-vercel-actions";

/**
 * D17.5.1 — mapeamento de texto puro para o estado de binding na Vercel
 * (`components/painel/vercel-binding-section.tsx` consome isto). Mesmo
 * princípio de `features/settings/domain-verification-messages.ts`
 * (D17.3.3): extraído do componente para ser testável sem depender de DOM
 * — este projeto roda `vitest` com `environment: "node"`, sem jsdom nem
 * `@testing-library/react`.
 */

export function resolveVercelStatusLabel(status: VercelDomainStatus): string {
  switch (status) {
    case "not_registered":
      return "Ainda não registrado";
    case "registering":
      return "Registrando";
    case "registered":
      return "Registrado";
    case "configuration_error":
      return "Configuração necessária";
    case "certificate_error":
      return "Erro de certificado";
    case "unknown":
      return "Erro temporário";
  }
}

export function resolveVercelStatusMessage(status: VercelDomainStatus): string {
  switch (status) {
    case "not_registered":
      return 'Este domínio já foi validado pelo VEXO. Clique em "Conectar à Vercel" para publicá-lo.';
    case "registering":
      return 'O domínio foi aceito, mas o DNS ainda não aponta para a Vercel. Ajuste o DNS do seu provedor e clique em "Verificar novamente".';
    case "registered":
      return "Domínio conectado e funcionando.";
    case "configuration_error":
      return "O DNS deste domínio precisa ser ajustado para apontar para a Vercel. Verifique a configuração no seu provedor e tente novamente.";
    case "certificate_error":
      return "Houve um problema ao emitir o certificado de segurança deste domínio. Tente novamente em alguns instantes.";
    case "unknown":
      return "Não foi possível confirmar o estado agora. Tente novamente em alguns instantes.";
  }
}

/** `not_registered` é a única situação que aciona `registerDomainOnVercel` — qualquer outro estado só reconsulta (`checkVercelDomainStatus`), nunca registra de novo. */
export function resolveVercelPrimaryActionLabel(status: VercelDomainStatus): string {
  return status === "not_registered" ? "Conectar à Vercel" : "Verificar novamente";
}

export function isRegisterAction(status: VercelDomainStatus): boolean {
  return status === "not_registered";
}
