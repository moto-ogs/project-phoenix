import { Suspense } from "react";
import CatererOverviewPage from "./page-content";
import { loadCatererOverviewSeed } from "~/lib/caterer/page-seed.server";
import { defaultPeriod, periodDays } from "~/lib/caterer-period";
import { berlinTodayISO } from "~/lib/date-helpers";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { catererKeys } from "~/lib/swr/portal-keys";

export default function CatererPage() {
  const today = berlinTodayISO();
  const days = periodDays(defaultPeriod(today), today);
  const from = days[0]!;
  const to = days[days.length - 1]!;
  const key = catererKeys.overview(from, to);
  const seed = loadCatererOverviewSeed(from, to, key).catch(() => null);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={[key]} render>
        <CatererOverviewPage />
      </SWRServerSeed>
    </Suspense>
  );
}
