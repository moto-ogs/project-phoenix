"use client";

import { useParentChildren, useParentFeatures } from "./use-parent-resources";
import type * as parentMeContract from "~/lib/contract/parent-me.generated";

export function useParentMealPlanEnabled(
  enabled: boolean,
  children?: readonly parentMeContract.ChildResponse[] | null,
): boolean {
  const linked = useParentChildren(enabled && children === undefined);
  const features = useParentFeatures(
    enabled ? (children ?? linked.data) : undefined,
  );
  return Object.values(features.data ?? {}).some(
    (f) => f.meal_plan_enabled === true,
  );
}
