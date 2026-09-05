import "server-only";

import { cache } from "react";

import { createSupabasePublicClient } from "@/lib/supabase/server";

/**
 * D17.4.1 — fundação isolada e testável de "host → tenant" para o Host
 * Routing (auditoria D17.4.0, seções K/L/N). Só a RESOLUÇÃO — nenhum
 * rewrite, nenhuma integração com `proxy.ts` (isso é D17.4.2, ainda não
 * implementado; este módulo não é chamado por nenhuma rota nesta etapa).
 *
 * Mesmo princípio de `features/storefront/resolve-tenant.ts`
 * (`resolveStorefrontTenant`): client `anon` (`createSupabasePublicClient()`,
 * nunca `service_role`), projeção explícita de colunas, `cache()` do React
 * só para dedupe dentro de uma única requisição (nunca cache entre
 * requests — nunca `unstable_cache`/`Map` module-level/Redis, ver auditoria
 * D17.4.0 §H/§5), e "não encontrado" cobrindo indistintamente todo motivo
 * de recusa — nunca revela ao chamador se o host não existe, está
 * pending/verifying, ou se o tenant por trás está suspended/pending/
 * deleted.
 *
 * `host` é sempre um valor já normalizado por
 * `lib/security/host-normalization.ts::normalizeHost()` — esta função não
 * normaliza nada sozinha, e nunca aceita `tenant_id` do chamador: o único
 * dado de entrada é o host, o único dado de saída (no caso `ready`) é o
 * `slug` a ser usado para renderizar `/loja/[slug]` — a mesma rota/
 * resolução que já existe, nunca uma segunda fonte de dado de tenant.
 */
export type HostTenantResolution = { status: "not_found" } | { status: "ready"; slug: string };

const NOT_FOUND: HostTenantResolution = { status: "not_found" };

/**
 * Regra de elegibilidade (D17.4.0 §N, decisão explícita desta etapa —
 * nunca herdada por acidente da policy pública de `tenants`, que hoje
 * também aceita `pending`, migration 20260817220022): só resolve quando
 * `tenant_domains.status = 'active'` **e** `tenants.status = 'active'`.
 * Qualquer outra combinação — domínio pending/verifying, tenant pending/
 * suspended/deleted, domínio ou tenant inexistente, ou qualquer erro que
 * impeça confirmar os dois — retorna o mesmo `{ status: "not_found" }`,
 * sem nunca expor `tenant_id`, status administrativo, ou detalhe interno
 * do banco.
 */
export const resolveTenantByHost = cache(
  async (host: string): Promise<HostTenantResolution> => {
    const supabase = createSupabasePublicClient();

    const { data: domainRow } = await supabase
      .from("tenant_domains")
      .select("tenant_id")
      .eq("domain", host)
      .eq("status", "active")
      .maybeSingle();

    if (!domainRow) return NOT_FOUND;

    const { data: tenantRow } = await supabase
      .from("tenants")
      .select("slug, status")
      .eq("id", domainRow.tenant_id as string)
      .maybeSingle();

    if (!tenantRow) return NOT_FOUND;
    // Explícito, não herdado: a policy pública de `tenants` (migration
    // 20260817220022) já permitiria ler uma linha `pending` aqui — esta
    // checagem é a única coisa que impede um domínio `active` de resolver
    // para um tenant que ainda não é `active` de verdade.
    if (tenantRow.status !== "active") return NOT_FOUND;

    return { status: "ready", slug: tenantRow.slug as string };
  },
);
