"use client";

import type { ReactNode } from "react";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { SWRServerSeed, type ServerSeedInput } from "~/lib/swr/server-seed";
import { mealPlanSeedKeys } from "./seed-keys";

export function mealPlanSeedClaims(today: string) {
  const { plan, cancellations, orders, participants, caterer } =
    mealPlanSeedKeys(today);
  return [plan, cancellations, orders, participants, caterer];
}

export function MealPlanSeed({
  seed,
  children,
}: {
  seed: ServerSeedInput;
  children: ReactNode;
}) {
  const claims = mealPlanSeedClaims(useBerlinToday());
  return (
    <SWRServerSeed seed={seed} claims={claims} render>
      {children}
    </SWRServerSeed>
  );
}
