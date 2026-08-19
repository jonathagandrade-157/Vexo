import { randomUUID } from "node:crypto";
import { withSuperuser } from "./db";

export interface Fixtures {
  tenantA: string;
  tenantB: string;
  roleIds: Record<"OWNER" | "ADMIN" | "MANAGER" | "OPERATOR" | "SUPPORT", string>;
  userAOwner: string;
  userAAdmin: string;
  userAManager: string;
  userBOwner: string;
  userOutsider: string;
  userMaster: string;
}

/**
 * Builds a small, deterministic multi-tenant fixture set used by every
 * scenario in rls-isolation.test.ts:
 *
 *   Tenant A: userAOwner (OWNER), userAAdmin (ADMIN, has team.manage),
 *             userAManager (MANAGER, no team.manage)
 *   Tenant B: userBOwner (OWNER)
 *   userOutsider: authenticated, member of nothing
 *   userMaster: platform_admins (MASTER)
 *
 * Created via withSuperuser (bypasses RLS unconditionally), never via the
 * policies under test.
 *
 * Every email/slug is tagged with a random run id so that multiple test
 * *files* (each calling buildFixtures() in its own beforeAll, against the
 * same shared database — there's no per-file DB reset) never collide on
 * the unique constraints of auth.users.email / tenants.slug.
 */
export async function buildFixtures(): Promise<Fixtures> {
  const runId = randomUUID().slice(0, 8);

  return withSuperuser(async (client) => {
    const roleRows = await client.query<{ key: string; id: string }>(
      "select key, id from public.roles",
    );
    const roleIds = Object.fromEntries(
      roleRows.rows.map((r) => [r.key, r.id]),
    ) as Fixtures["roleIds"];

    async function createUser(label: string): Promise<string> {
      const email = `${label}-${runId}@fixtures.test`;
      const { rows } = await client.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [email],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error(`failed to create auth.users row for ${email}`);
      return id;
    }

    async function createTenant(name: string, slugBase: string, createdBy: string): Promise<string> {
      const slug = `${slugBase}-${runId}`;
      const { rows } = await client.query<{ id: string }>(
        "insert into public.tenants (name, slug, created_by) values ($1, $2, $3) returning id",
        [name, slug, createdBy],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error(`failed to create tenant ${slug}`);
      return id;
    }

    async function addMember(tenantId: string, userId: string, roleKey: keyof Fixtures["roleIds"]) {
      await client.query(
        "insert into public.tenant_members (tenant_id, user_id, role_id) values ($1, $2, $3)",
        [tenantId, userId, roleIds[roleKey]],
      );
    }

    const userAOwner = await createUser("owner-a");
    const userAAdmin = await createUser("admin-a");
    const userAManager = await createUser("manager-a");
    const userBOwner = await createUser("owner-b");
    const userOutsider = await createUser("outsider");
    const userMaster = await createUser("master");

    const tenantA = await createTenant("Tenant A", "tenant-a", userAOwner);
    const tenantB = await createTenant("Tenant B", "tenant-b", userBOwner);

    await addMember(tenantA, userAOwner, "OWNER");
    await addMember(tenantA, userAAdmin, "ADMIN");
    await addMember(tenantA, userAManager, "MANAGER");
    await addMember(tenantB, userBOwner, "OWNER");

    await client.query(
      "insert into public.platform_admins (user_id, role) values ($1, 'MASTER')",
      [userMaster],
    );

    return { tenantA, tenantB, roleIds, userAOwner, userAAdmin, userAManager, userBOwner, userOutsider, userMaster };
  });
}
