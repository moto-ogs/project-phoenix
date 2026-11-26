"use client";

import type { ReactNode } from "react";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { SWRServerSeed, type ServerSeedInput } from "~/lib/swr/server-seed";
import { mealPlanSeedKeys } from "./seed-keys";

export function MealPlanSeed({
  seed,
  children,
}: {
  seed: ServerSeedInput;
  children: ReactNode;
}) {
  const { plan, orders, participants, caterer } =
    mealPlanSeedKeys(useBerlinToday());
  return (
    <SWRServerSeed
      seed={seed}
      claims={[plan, orders, participants, caterer]}
      render
    >
      {children}
    </SWRServerSeed>
  );
}
