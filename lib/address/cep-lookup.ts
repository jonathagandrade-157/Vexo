import "server-only";

/**
 * Fase D2-B.2 — autofill do endereço da loja em Configurações. Só chamado
 * pontualmente quando o lojista digita/confirma o CEP da própria loja
 * (`features/settings/address-actions.ts::lookupStoreAddressAction`) —
 * NUNCA no checkout do cliente (o endereço do cliente continua sendo
 * digitado manualmente, sem autofill, como já era).
 *
 * BrasilAPI v2 (não ViaCEP) por já agregar múltiplas fontes (Correios/
 * ViaCEP) com fallback automático entre provedores — menor chance de o
 * autofill falhar por uma fonte específica estar fora do ar. Sem chave,
 * sem custo.
 *
 * Nunca lança: qualquer falha (timeout, CEP inexistente, resposta
 * malformada, serviço fora do ar) retorna `null` — quem chama decide o
 * que fazer (nesta fase: deixar os campos em branco para preenchimento
 * manual, nunca bloquear o cadastro da loja por uma API externa estar
 * indisponível).
 */

const LOOKUP_TIMEOUT_MS = 5_000;
const BRASILAPI_CEP_V2_URL = "https://brasilapi.com.br/api/cep/v2";

export interface CepLookupResult {
  street: string;
  neighborhood: string;
  city: string;
  state: string;
}

interface BrasilApiCepV2Response {
  cep?: string;
  state?: string;
  city?: string;
  neighborhood?: string;
  street?: string;
}

export async function lookupCep(rawCep: string): Promise<CepLookupResult | null> {
  const cep = rawCep.replace(/\D/g, "");
  if (cep.length !== 8) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);

  try {
    const response = await fetch(`${BRASILAPI_CEP_V2_URL}/${cep}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;

    const data = (await response.json()) as BrasilApiCepV2Response;
    if (!data.city || !data.state) return null;

    return {
      street: data.street ?? "",
      neighborhood: data.neighborhood ?? "",
      city: data.city,
      state: data.state,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
