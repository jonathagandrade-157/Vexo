import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { saveSimpleProductStock } from "@/features/products/stock";
import { computeSaveStatus } from "@/features/products/save-status";

type Result = { error: { code: string } | null; count?: number };
function fixture(results: Result[]) {
  const calls: { kind: string; filters: unknown[][]; payload: unknown }[] = [];
  const client = { from() {
    const call = { kind: "", filters: [] as unknown[][], payload: undefined as unknown };
    calls.push(call);
    const builder = {
      delete() { call.kind = "delete"; return builder; },
      update(payload: unknown) { call.kind = "update"; call.payload = payload; return builder; },
      insert(payload: unknown) { call.kind = "insert"; call.payload = payload; return builder; },
      eq(...filter: unknown[]) { call.filters.push(["eq", ...filter]); return builder; },
      is(...filter: unknown[]) { call.filters.push(["is", ...filter]); return builder; },
      then(accept: (result: Result) => unknown) {
        const result = results.shift();
        if (!result) throw new Error("Unexpected inventory operation");
        return Promise.resolve(result).then(accept);
      },
    };
    return builder;
  } } as unknown as SupabaseClient;
  return { client, calls };
}

describe("base stock persistence after variant partial indexes", () => {
  it("inserts missing stock without an unsupported ON CONFLICT target", async () => {
    const { client, calls } = fixture([{ error: null, count: 0 }, { error: null }]);
    expect(await saveSimpleProductStock(client, "tenant", "product", 8, 2)).toBe(true);
    expect(calls[1]).toMatchObject({ kind: "insert", payload: { tenant_id: "tenant", product_id: "product", variant_id: null, stock_quantity: 8, low_stock_threshold: 2 } });
  });

  it("updates only base stock belonging to that tenant/product", async () => {
    const { client, calls } = fixture([{ error: null, count: 1 }]);
    expect(await saveSimpleProductStock(client, "tenant", "product", 3, undefined)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.filters).toEqual([["eq", "product_id", "product"], ["eq", "tenant_id", "tenant"], ["is", "variant_id", null]]);
  });

  it("clearing base stock cannot remove the variants' stock controls", async () => {
    const { client, calls } = fixture([{ error: null }]);
    expect(await saveSimpleProductStock(client, "tenant", "product", undefined, undefined)).toBe(true);
    expect(calls[0]).toMatchObject({ kind: "delete", filters: expect.arrayContaining([["is", "variant_id", null], ["eq", "tenant_id", "tenant"]]) });
  });

  it("recovers one concurrent insertion without duplicating inventory", async () => {
    const { client, calls } = fixture([{ error: null, count: 0 }, { error: { code: "23505" } }, { error: null, count: 1 }]);
    expect(await saveSimpleProductStock(client, "tenant", "product", 3, undefined)).toBe(true);
    expect(calls.filter((call) => call.kind === "insert")).toHaveLength(1);
  });

  it("does not report success after denied, lost or failed stock writes", async () => {
    for (const results of [
      [{ error: { code: "42501" } }],
      [{ error: null, count: 0 }, { error: { code: "42501" } }],
      [{ error: null, count: 0 }, { error: { code: "23505" } }, { error: null, count: 0 }],
    ]) {
      expect(await saveSimpleProductStock(fixture(results).client, "tenant", "product", 3, undefined)).toBe(false);
    }
    expect(await saveSimpleProductStock(fixture([{ error: { code: "42501" } }]).client, "tenant", "product", undefined, undefined)).toBe(false);
  });

  it("never labels a partially saved product as fully saved", () => {
    expect(computeSaveStatus({ isEditMode: false, justCreated: true, gallerySettled: true, galleryHasFailure: false, configStatus: "success", stockSaveFailed: true })).toBe("failed");
  });
});
