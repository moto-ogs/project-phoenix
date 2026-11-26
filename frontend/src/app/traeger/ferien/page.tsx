import { holidayPeriods } from "~/lib/traeger/holiday-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { traegerPageSeed } from "~/lib/traeger/page-seed.server";
import TraegerHolidayPeriodsPage from "./page-content";

export default function Page() {
  const { seed, claims } = traegerPageSeed([holidayPeriods]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerHolidayPeriodsPage />
      </SWRServerSeed>
    </Suspense>
  );
}
