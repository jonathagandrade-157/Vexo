import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { ShippingRefreshError, type ShippingConnectionProvider } from "./gateway";
import { getShippingConnectionGateway } from "./registry";
import { getShippingCredentials, storeShippingCredentials } from "./vault";

const PROVIDER: ShippingConnectionProvider = "melhor_envio";

/**
 * D3.2-B Ponto 1B — margem de segurança: renova o access_token quando
 * faltar menos de REFRESH_MARGIN_SECONDS para expirar, nunca espera a
 * expiração de fato acontecer. 24h é ~3,3% dos 30 dias de validade do
 * access_token do Melhor Envio (confirmado em docs.melhorenvio.com.br)
 * — folga suficiente para algumas tentativas de retry em caso de falha
 * transitória (a próxima requisição tenta de novo, dado que a renovação
 * é lazy, nunca um cron), sem ser uma margem "arbitrariamente enorme".
 */
export const REFRESH_MARGIN_SECONDS = 24 * 60 * 60;

/**
 * Duração do lease de renovação (ver migration 20260817220088) — impede
 * que duas requisições concorrentes dupliquem a renovação para o mesmo
 * tenant num ambiente serverless (sem memória de processo compartilhada).
 * Curto o bastante para não travar uma tentativa legítima por muito
 * tempo caso o processo que reivindicou o lease morra no meio da chamada
 * HTTP ao Melhor Envio (timeout da própria chamada é de 10s — ver
 * TOKEN_REQUEST_TIMEOUT_MS em melhorenvio.ts).
 */
export const REFRESH_LEASE_SECONDS = 60;

export type EnsureFreshTokenStatus =
  | "valid" // token atual já está fora da margem de expiração, nada a fazer
  | "refreshed" // renovado agora com sucesso
  | "refresh_in_progress" // outra requisição já está renovando (lease em vigor) — usa o token atual, ainda utilizável dentro da margem
  | "refresh_failed_temporary" // falha transitória (rede/timeout/5xx/rate limit/resposta malformada) — token antigo preservado, não desconectado
  | "not_connected" // tenant nunca conectou este provider
  | "needs_reconnection"; // refresh_token confirmadamente inválido/expirado — só este caso marca a conexão como desconectada

export interface EnsureFreshTokenResult {
  status: EnsureFreshTokenStatus;
  /**
   * Só para uso de código server-side que vai de fato chamar a API do
   * Melhor Envio em seguida (ex.: uma futura cotação/etiqueta) — nunca
   * deve ser repassado a um Client Component, JSON de resposta ao
   * navegador, cookie, localStorage/sessionStorage ou log. `null` quando
   * não há nenhum token utilizável (not_connected/needs_reconnection) ou
   * quando refresh_failed_temporary acontece sem nenhum token
   * previamente armazenado.
   */
  accessToken: string | null;
}

async function releaseLease(tenantId: string): Promise<void> {
  const supabase = createSupabaseServiceRoleClient();
  await supabase.rpc("release_shipping_credentials_refresh_lease", { p_tenant_id: tenantId, p_provider: PROVIDER });
}

/**
 * Marca a conexão como precisando de reconexão — SOMENTE quando há
 * evidência real de que o refresh_token não pode mais ser usado
 * (ShippingRefreshError.code === "INVALID_REFRESH_TOKEN"). Reaproveita o
 * status `disconnected` já existente (mesmo significado que a
 * desconexão manual do lojista) em vez de inventar um terceiro estado —
 * a UI de `/painel/configuracoes/entrega` já sabe mostrar "Não conectado"
 * + botão "Conectar" para esse status, sem nenhuma mudança de UI
 * necessária aqui. Nunca apaga os secrets do Vault (diferente da
 * desconexão manual): não há necessidade de destruir o histórico, e uma
 * futura reconexão via OAuth já sobrescreve tudo via
 * `store_shipping_credentials` (upsert + limpeza do segredo antigo).
 */
async function markNeedsReconnection(tenantId: string): Promise<void> {
  const supabase = createSupabaseServiceRoleClient();
  await supabase
    .from("store_shipping_providers")
    .update({ status: "disconnected", disconnected_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("provider", PROVIDER);
}

/**
 * Ponto único de renovação server-only do access_token do Melhor Envio
 * (D3.2-B Ponto 1B). Carrega credenciais exclusivamente pelo Vault
 * (`lib/shipping-connections/vault.ts` — nunca duplica acesso ao
 * Supabase Vault fora dali), verifica a expiração com a margem de
 * segurança, renova só quando necessário, atualiza o Vault, e devolve
 * somente o `accessToken` (nunca o `refresh_token`, nunca o
 * `client_secret`) para quem chamou continuar a operação.
 *
 * `tenantId` é sempre um parâmetro explícito resolvido pelo CHAMADOR a
 * partir de uma sessão/contexto de servidor já autorizado — esta função
 * nunca resolve tenant a partir de cookie/sessão sozinha (ela é uma
 * função de biblioteca, não um Server Action/Route Handler) e nunca
 * aceita um segundo tenant "de troca" — todo acesso ao Vault é sempre
 * escopado pelo mesmo `tenantId` recebido, do início ao fim.
 */
export async function ensureFreshMelhorEnvioToken(tenantId: string): Promise<EnsureFreshTokenResult> {
  const supabase = createSupabaseServiceRoleClient();

  const { data: providerRow } = await supabase
    .from("store_shipping_providers")
    .select("status")
    .eq("tenant_id", tenantId)
    .eq("provider", PROVIDER)
    .maybeSingle();

  if (!providerRow) return { status: "not_connected", accessToken: null };
  if (providerRow.status !== "connected") return { status: "needs_reconnection", accessToken: null };

  const { data, error } = await supabase.rpc("acquire_shipping_credentials_refresh_lease", {
    p_tenant_id: tenantId,
    p_provider: PROVIDER,
    p_margin_seconds: REFRESH_MARGIN_SECONDS,
    p_lease_seconds: REFRESH_LEASE_SECONDS,
  });
  if (error) throw new Error("Não foi possível verificar as credenciais de frete.");
  const lease = Array.isArray(data) ? data[0] : data;
  if (!lease) throw new Error("Não foi possível verificar as credenciais de frete.");

  if (lease.reason === "not_connected") return { status: "not_connected", accessToken: null };

  if (lease.reason === "not_needed" || lease.reason === "already_refreshing") {
    // Token ainda dentro da margem, OU outra requisição já está
    // renovando (o token atual ainda deve funcionar por mais alguns
    // instantes — é exatamente o que a margem de segurança garante).
    // Nunca dispara uma segunda renovação nestes dois casos.
    const credentials = await getShippingCredentials(tenantId, PROVIDER);
    return {
      status: lease.reason === "not_needed" ? "valid" : "refresh_in_progress",
      accessToken: credentials?.accessToken ?? null,
    };
  }

  // lease.reason === "claimed" — esta chamada, e só ela, deve renovar agora.
  if (!lease.refresh_token) {
    // Nunca deveria acontecer (exchangeCodeForTokens sempre grava um
    // refresh_token junto do access_token), mas se acontecer não há como
    // renovar — trata como precisando reconectar em vez de tentar de
    // novo indefinidamente.
    await releaseLease(tenantId);
    await markNeedsReconnection(tenantId);
    return { status: "needs_reconnection", accessToken: null };
  }

  if (lease.refresh_expires_at && new Date(lease.refresh_expires_at as string) <= new Date()) {
    // Expiração do refresh_token já conhecida localmente — nem tenta a
    // chamada de rede (o Melhor Envio certamente vai rejeitar), e essa é
    // a diferenciação entre "expirado" (sabido sem round-trip) e
    // "inválido" (só descoberto pela resposta do provedor, abaixo).
    await releaseLease(tenantId);
    await markNeedsReconnection(tenantId);
    return { status: "needs_reconnection", accessToken: null };
  }

  const gateway = getShippingConnectionGateway(PROVIDER);
  try {
    const tokens = await gateway.refreshAccessToken(lease.refresh_token as string);
    await storeShippingCredentials(tenantId, PROVIDER, {
      accessToken: tokens.accessToken,
      // Rotation (prompt D3.2-B Ponto 1B): só substitui o refresh_token
      // se o Melhor Envio devolveu um novo; senão preserva o atual.
      refreshToken: tokens.refreshToken ?? (lease.refresh_token as string),
      expiresAt: tokens.expiresAt,
      refreshExpiresAt: tokens.refreshExpiresAt ?? (lease.refresh_expires_at ? new Date(lease.refresh_expires_at as string) : null),
    });
    return { status: "refreshed", accessToken: tokens.accessToken };
  } catch (err) {
    if (err instanceof ShippingRefreshError && err.code === "INVALID_REFRESH_TOKEN") {
      await releaseLease(tenantId);
      await markNeedsReconnection(tenantId);
      return { status: "needs_reconnection", accessToken: null };
    }

    // Qualquer outro erro (timeout, rede, 5xx, rate limit, resposta
    // malformada, e também INVALID_CLIENT — que é sobre a credencial DO
    // VEXO, nunca do tenant) é tratado como transitório: nunca desconecta
    // o tenant nem apaga credenciais válidas por causa de uma falha
    // passageira. Loga só o necessário para diagnóstico — nunca o
    // token/refresh_token/client_secret (a mensagem de erro do gateway já
    // é construída sem eles, ver melhorenvio.ts).
    console.error("[shipping-connections] melhor_envio token refresh failed", {
      tenantId,
      code: err instanceof ShippingRefreshError ? err.code : "UNKNOWN",
      status: err instanceof ShippingRefreshError ? err.status : null,
    });
    await releaseLease(tenantId);

    const credentials = await getShippingCredentials(tenantId, PROVIDER);
    return { status: "refresh_failed_temporary", accessToken: credentials?.accessToken ?? null };
  }
}
