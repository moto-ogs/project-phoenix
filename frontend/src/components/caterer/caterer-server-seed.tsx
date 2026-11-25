"use client";

import type { ReactNode } from "react";
import type { CatererSchools } from "~/lib/caterer-api";
import { defaultPeriod, periodDays } from "~/lib/caterer-period";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { catererKeys } from "~/lib/swr/portal-keys";
import { SWRServerSeed, type ServerSeedInput } from "~/lib/swr/server-seed";

const SCHOOLS_KEY = catererKeys.schools();
const CLAIMS = [SCHOOLS_KEY];

export function CatererServerSeed({
  seed,
  children,
}: Readonly<{ seed: ServerSeedInput; children: ReactNode }>) {
  const today = useBerlinToday();
  return (
    <SWRServerSeed
      seed={seed}
      claims={CLAIMS}
      claimsFrom={{
        key: SCHOOLS_KEY,
        derive: (supplied: CatererSchools) => {
          const days = periodDays(defaultPeriod(today), today);
          return [
            catererKeys.orders(
              supplied.schools.map(({ id }) => id),
              days[0]!,
              days[days.length - 1]!,
            ),
          ];
        },
      }}
      render
    >
      {children}
    </SWRServerSeed>
  );
}
