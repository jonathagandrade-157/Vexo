"use client";

import { useState, useTransition } from "react";

import { togglePlanFeatureAction } from "@/features/commercial/actions";
import type { FeatureRow } from "@/features/commercial/data";

/**
 * A tela central do prompt §19 — checkbox por recurso, agrupado por
 * categoria. Cada toggle chama `togglePlanFeatureAction` diretamente
 * (INSERT/DELETE em `plan_features`) — otimista na UI (`useState` local),
 * mas a fonte de verdade é sempre o banco: se a Server Action falhar, o
 * checkbox volta ao estado anterior.
 */
export function PlanFeatureChecklist({
  planId,
  features,
  initialFeatureIds,
}: {
  planId: string;
  features: FeatureRow[];
  initialFeatureIds: string[];
}) {
  const [enabledIds, setEnabledIds] = useState(new Set(initialFeatureIds));
  const [pendingId, startTransition] = useTransition();

  const byCategory = new Map<string, FeatureRow[]>();
  for (const feature of features) {
    const category = feature.category ?? "Outros";
    byCategory.set(category, [...(byCategory.get(category) ?? []), feature]);
  }

  function handleToggle(feature: FeatureRow, nextEnabled: boolean) {
    const previous = new Set(enabledIds);
    setEnabledIds((current) => {
      const next = new Set(current);
      if (nextEnabled) next.add(feature.id);
      else next.delete(feature.id);
      return next;
    });

    startTransition(async () => {
      const result = await togglePlanFeatureAction(planId, feature.id, nextEnabled);
      if (result.status === "error") {
        setEnabledIds(previous);
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {Array.from(byCategory.entries()).map(([category, categoryFeatures]) => (
        <div className="flex flex-col gap-2" key={category}>
          <h3 className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">{category}</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {categoryFeatures.map((feature) => {
              const checked = enabledIds.has(feature.id);
              return (
                <label
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                    checked ? "border-tertiary/50 bg-tertiary-container/10" : "border-outline-variant/40 bg-surface-container-lowest"
                  } ${!feature.is_active ? "opacity-50" : ""}`}
                  key={feature.id}
                >
                  <input
                    checked={checked}
                    className="h-4 w-4 accent-tertiary"
                    disabled={pendingId}
                    onChange={(e) => handleToggle(feature, e.target.checked)}
                    type="checkbox"
                  />
                  <span className="flex flex-col">
                    <span className="font-body text-body-sm text-on-surface">
                      {feature.name}
                      {!feature.is_active ? " (desativado globalmente)" : ""}
                    </span>
                    <span className="font-body text-body-sm text-on-surface-variant">{feature.key}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
