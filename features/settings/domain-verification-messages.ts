import type { TenantDomainRow } from "./domain-actions";

/**
 * D17.3.3 — UI de verificação de domínio (`components/painel/domain-verification-card.tsx`)
 * consome `startDomainVerification`/`checkDomainVerification` (D17.3.2); este
 * módulo só decide TEXTO e VISIBILIDADE de controles a partir do que essas
 * Server Actions já decidiram — nunca reimplementa a decisão de status, nunca
 * toca banco/DNS. Extraído do componente para ser testável sem depender de
 * DOM: este projeto roda `vitest` com `environment: "node"`, sem jsdom nem
 * `@testing-library/react` (ver `tests/unit/product-image-uploader-no-nested-form.test.ts`,
 * D11.7) — funções puras aqui podem ser testadas diretamente, o componente
 * fica só como a "view" fina em cima delas.
 */

export const DNS_TXT_RECORD_TYPE = "TXT";

/**
 * O projeto não tem nenhuma convenção existente de TTL para registros DNS
 * (nenhuma outra tela do painel exibe TTL) — 3600s é só orientação visual
 * para o lojista, o provedor de DNS dele decide o valor real (ticket
 * D17.3.3 §5: "utilizar 3600 somente como orientação visual").
 */
export const DNS_TXT_TTL_SECONDS = 3600;

export interface VerificationCheckOutcome {
  expired?: boolean;
  reason?: "no_match" | "not_found" | "dns_error";
}

/**
 * Monta a mensagem de status exibida ao lojista (ticket D17.3.3 §8).
 * `hasChallenge` distingue os dois casos de `verifying`: logo após
 * `startDomainVerification` (token em texto puro ainda em memória no
 * client, instruções visíveis) vs. uma página recarregada enquanto já
 * `verifying` de uma visita anterior (o token nunca é persistido — D17.3.1/
 * D17.3.2 — então não há como reexibi-lo sem gerar um novo challenge).
 */
export function resolveVerificationMessage(
  status: TenantDomainRow["status"],
  hasChallenge: boolean,
  outcome?: VerificationCheckOutcome,
): string {
  if (outcome?.expired) {
    return "Este desafio expirou. Inicie uma nova verificação.";
  }
  if (outcome?.reason === "no_match") {
    return "O registro TXT ainda não foi encontrado. Confira os dados de DNS e tente novamente.";
  }
  if (outcome?.reason === "not_found") {
    return "Não encontramos o registro TXT. A propagação do DNS pode levar algum tempo.";
  }
  if (outcome?.reason === "dns_error") {
    return "Não foi possível consultar o DNS agora. Tente novamente em alguns instantes.";
  }
  if (status === "active") {
    return "Domínio verificado.";
  }
  if (status === "verifying") {
    return hasChallenge
      ? "Adicione o registro TXT abaixo e depois clique em Verificar domínio."
      : "Você já iniciou a verificação deste domínio. Gere novas instruções de DNS para continuar.";
  }
  return "Configure o registro TXT para iniciar a verificação.";
}

export interface VerificationUiState {
  showStartButton: boolean;
  startLabel: string;
  showCheckButton: boolean;
  showChallenge: boolean;
}

/**
 * Decide quais controles mostrar — nunca decide o status em si (isso já
 * veio de `domain.status`/`checkDomainVerification`). `active` nunca mostra
 * "Iniciar verificação" automaticamente (ticket §9): o único botão
 * disponível ali é a revalidação explícita ("Verificar novamente"), que
 * também chama `startDomainVerification` por baixo, mas com um rótulo que
 * deixa a intenção clara para o lojista.
 */
export function resolveVerificationUiState(
  status: TenantDomainRow["status"],
  hasChallenge: boolean,
  expired: boolean,
): VerificationUiState {
  if (status === "active") {
    return { showStartButton: true, startLabel: "Verificar novamente", showCheckButton: false, showChallenge: hasChallenge };
  }
  if (status === "pending") {
    return {
      showStartButton: true,
      startLabel: expired ? "Iniciar nova verificação" : "Iniciar verificação",
      showCheckButton: false,
      showChallenge: false,
    };
  }
  // verifying
  return {
    showStartButton: !hasChallenge,
    startLabel: "Ver instruções de DNS",
    showCheckButton: hasChallenge,
    showChallenge: hasChallenge,
  };
}

/**
 * Cópia para a área de transferência com injeção de dependência (recebe
 * `navigator.clipboard`, nunca o lê sozinho) — só para permitir testar o
 * comportamento (sucesso/indisponível/erro) sem DOM real. Falha
 * silenciosamente (retorna `false`) quando `clipboard` está ausente ou
 * `writeText` rejeita — nunca lança, nunca expõe o erro técnico ao lojista
 * (ticket §6: "tratar erro de clipboard de maneira amigável").
 */
export async function copyToClipboard(
  clipboard: { writeText: (value: string) => Promise<void> } | null | undefined,
  value: string,
): Promise<boolean> {
  if (!clipboard) return false;
  try {
    await clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
