import { berlinTodayISO } from "~/lib/date-helpers";
import {
  closingDays,
  pendingHolidayClosures,
} from "~/lib/traeger/holiday-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { traegerPageSeed } from "~/lib/traeger/page-seed.server";
import TraegerClosingDaysPage from "./page-content";

export default function Page() {
  const year = berlinTodayISO().slice(0, 4);
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const { seed, claims } = traegerPageSeed([
    closingDays(from, to),
    { ...pendingHolidayClosures, permission: "traeger_settings:manage" },
  ]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerClosingDaysPage />
      </SWRServerSeed>
    </Suspense>
  );
}
