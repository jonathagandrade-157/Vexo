import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export const TENANT_STATUS_FILTERS = ["pending", "active", "suspended"] as const;
export type TenantStatusFilter = (typeof TENANT_STATUS_FILTERS)[number];

export interface MasterTenantRow {
  id: string;
  name: string;
  slug: string;
  segment: string | null;
  status: string;
  createdAt: string;
  ownerName: string | null;
  ownerEmail: string | null;
  planName: string | null;
  trialStatus: string | null;
  trialEndsAt: string | null;
}

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

interface TenantJoinRow {
  id: string;
  name: string;
  slug: string;
  segment: string | null;
  status: string;
  created_at: string;
  trial_records: { status: string; ends_at: string }[] | { status: string; ends_at: string } | null;
  subscriptions:
    | { plans: { name: string } | { name: string }[] | null }
    | { plans: { name: string } | { name: string }[] | null }[]
    | null;
}

/**
 * Listagem de lojas para o painel MASTER (Etapa 18). RLS de `tenants`
 * (migration 20260817220012) já deixa `is_platform_admin()` (MASTER ou
 * SUPPORT_AGENT) ver TODOS os tenants — não é uma consulta nova de
 * autorização, só um novo consumidor do que já existe.
 *
 * `profiles` não tem FK direta com `tenant_members` (ambos referenciam
 * `auth.users` separadamente) — por isso o proprietário é resolvido em
 * duas consultas extras, nunca um embed do PostgREST através de uma
 * relação que não existe de verdade.
 *
 * D3.2-B Ponto 2F.4 (correção) — `subscriptions` tem DUAS FKs para
 * `plans` (`plan_id` e `pending_plan_id`, esta desde a migration
 * 20260817220070), então o embed `subscriptions(plans(...))` sem
 * desambiguação é rejeitado pelo PostgREST (PGRST201, "more than one
 * relationship was found") — a query inteira falhava, e como o `error`
 * era descartado, virava silenciosamente `[]`. `plans!subscriptions_plan_id_fkey`
 * fixa explicitamente a relação pelo plano ATUAL (nunca `pending_plan_id`,
 * que não existe para exibição aqui). Uma falha real do Supabase agora
 * propaga como exceção (nunca vira `[]`) — mesma lógica de "log técnico
 * sem PII + lançar", só que aqui lançar é o comportamento certo (painel
 * interno da equipe VEXO, não uma tela de cliente): cai no error.tsx de
 * `/master/lojas`, nunca fica indistinguível de "nenhuma loja".
 */
export async function listTenantsForMaster(statusFilter?: TenantStatusFilter): Promise<MasterTenantRow[]> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("tenants")
    .select(
      "id, name, slug, segment, status, created_at, trial_records(status, ends_at), subscriptions(plans!subscriptions_plan_id_fkey(name))",
    )
    .order("created_at", { ascending: false });

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[listTenantsForMaster] failed to load tenants", { statusFilter, error: error.message });
    throw new Error("Não foi possível carregar as lojas.");
  }
  const tenants = (data ?? []) as unknown as TenantJoinRow[];
  if (tenants.length === 0) return [];

  const tenantIds = tenants.map((t) => t.id);

  const { data: memberRows } = await supabase
    .from("tenant_members")
    .select("tenant_id, user_id, role:roles(key)")
    .in("tenant_id", tenantIds);

  const ownerUserIdByTenant = new Map<string, string>();
  for (const row of (memberRows ?? []) as unknown as {
    tenant_id: string;
    user_id: string;
    role: { key: string } | { key: string }[] | null;
  }[]) {
    if (first(row.role)?.key === "OWNER") {
      ownerUserIdByTenant.set(row.tenant_id, row.user_id);
    }
  }

  const ownerUserIds = [...new Set(ownerUserIdByTenant.values())];
  const { data: profileRows } = ownerUserIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", ownerUserIds)
    : { data: [] as { id: string; full_name: string | null; email: string | null }[] };

  const profileById = new Map((profileRows ?? []).map((p) => [p.id, p]));

  return tenants.map((t) => {
    const ownerUserId = ownerUserIdByTenant.get(t.id);
    const owner = ownerUserId ? profileById.get(ownerUserId) : undefined;
    const trial = first(t.trial_records);
    const subscription = first(t.subscriptions);
    const plan = subscription ? first(subscription.plans) : null;

    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      segment: t.segment,
      status: t.status,
      createdAt: t.created_at,
      ownerName: owner?.full_name ?? null,
      ownerEmail: owner?.email ?? null,
      planName: plan?.name ?? null,
      trialStatus: trial?.status ?? null,
      trialEndsAt: trial?.ends_at ?? null,
    };
  });
}

export interface MasterTenantMember {
  userId: string;
  fullName: string | null;
  email: string | null;
  roleKey: string;
}

/** Assinatura da loja para a seção "Plano da loja" (Etapa 20.1) — inclui `id`/`planId` porque `updateTenantPlanAction` precisa deles, além dos dados só de exibição (preço, status, datas). */
export interface TenantSubscriptionForMaster {
  id: string;
  planId: string;
  planSlug: string;
  planName: string;
  monthlyPrice: number | null;
  yearlyPrice: number | null;
  status: string;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
}

export interface MasterTenantDetail extends MasterTenantRow {
  onboardingCompletedAt: string | null;
  members: MasterTenantMember[];
  /** `null` quando a loja não tem nenhuma assinatura ainda — a Etapa 20.1 nunca cria uma automaticamente (só troca `plan_id` de uma já existente). */
  subscription: TenantSubscriptionForMaster | null;
}

interface TenantDetailSubscriptionRow {
  id: string;
  plan_id: string;
  status: string;
  trial_end: string | null;
  current_period_end: string | null;
  plans: { name: string; slug: string; monthly_price: number | null; yearly_price: number | null } | { name: string; slug: string; monthly_price: number | null; yearly_price: number | null }[] | null;
}

/**
 * Detalhe de uma loja para `/master/lojas/[id]` — mesma fonte de dados da
 * listagem, só escopada a um tenant e com todos os membros (não só o
 * OWNER). Select próprio (não reaproveita `TenantJoinRow`) porque só aqui
 * precisamos dos campos de `subscriptions` usados pela troca de plano
 * (Etapa 20.1) — a listagem continua enxuta.
 *
 * D3.2-B Ponto 2F.4 (correção) — mesma desambiguação de
 * `listTenantsForMaster` (`plans!subscriptions_plan_id_fkey`, nunca
 * `pending_plan_id`) e mesma regra: um `error` real do Supabase lança,
 * nunca vira `null` — `null` continua reservado exclusivamente para "esse
 * tenant_id não existe" (nenhuma linha, sem erro), que é o que
 * `app/master/lojas/[id]/page.tsx` usa para decidir `notFound()`.
 */
export async function getTenantDetailForMaster(tenantId: string): Promise<MasterTenantDetail | null> {
  const supabase = await createSupabaseServerClient();

  const { data: tenant, error } = await supabase
    .from("tenants")
    .select(
      "id, name, slug, segment, status, onboarding_completed_at, created_at, trial_records(status, ends_at), subscriptions(id, plan_id, status, trial_end, current_period_end, plans!subscriptions_plan_id_fkey(name, slug, monthly_price, yearly_price))",
    )
    .eq("id", tenantId)
    .maybeSingle();

  if (error) {
    console.error("[getTenantDetailForMaster] failed to load tenant", { tenantId, error: error.message });
    throw new Error("Não foi possível carregar os dados da loja.");
  }
  if (!tenant) return null;
  const t = tenant as unknown as Omit<TenantJoinRow, "subscriptions"> & {
    onboarding_completed_at: string | null;
    subscriptions: TenantDetailSubscriptionRow | TenantDetailSubscriptionRow[] | null;
  };

  const { data: memberRows } = await supabase
    .from("tenant_members")
    .select("user_id, role:roles(key)")
    .eq("tenant_id", tenantId)
    .eq("status", "active");

  const members = (memberRows ?? []) as unknown as { user_id: string; role: { key: string } | { key: string }[] | null }[];
  const userIds = members.map((m) => m.user_id);

  const { data: profileRows } = userIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", userIds)
    : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
  const profileById = new Map((profileRows ?? []).map((p) => [p.id, p]));

  const ownerUserId = members.find((m) => first(m.role)?.key === "OWNER")?.user_id;
  const owner = ownerUserId ? profileById.get(ownerUserId) : undefined;
  const trial = first(t.trial_records);
  const subscription = first(t.subscriptions);
  const plan = subscription ? first(subscription.plans) : null;

  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    segment: t.segment,
    status: t.status,
    createdAt: t.created_at,
    onboardingCompletedAt: t.onboarding_completed_at,
    ownerName: owner?.full_name ?? null,
    ownerEmail: owner?.email ?? null,
    planName: plan?.name ?? null,
    trialStatus: trial?.status ?? null,
    trialEndsAt: trial?.ends_at ?? null,
    members: members.map((m) => ({
      userId: m.user_id,
      fullName: profileById.get(m.user_id)?.full_name ?? null,
      email: profileById.get(m.user_id)?.email ?? null,
      roleKey: first(m.role)?.key ?? "—",
    })),
    subscription:
      subscription && plan
        ? {
            id: subscription.id,
            planId: subscription.plan_id,
            planSlug: plan.slug,
            planName: plan.name,
            monthlyPrice: plan.monthly_price,
            yearlyPrice: plan.yearly_price,
            status: subscription.status,
            trialEnd: subscription.trial_end,
            currentPeriodEnd: subscription.current_period_end,
          }
        : null,
  };
}
