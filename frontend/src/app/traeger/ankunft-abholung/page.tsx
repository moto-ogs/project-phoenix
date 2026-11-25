import { connection } from "next/server";
import { addDays } from "date-fns/addDays";
import { berlinTodayISO, parseISODate, toISODate } from "~/lib/date-helpers";
import { arrivalPickupTimes } from "~/lib/traeger/metrics-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { traegerPageSeed } from "~/lib/traeger/page-seed.server";
import TraegerArrivalPickupPage from "./page-content";

export default async function Page() {
  await connection();
  const today = berlinTodayISO();
  const day = parseISODate(today);
  const to = toISODate(addDays(day, -1));
  const from = toISODate(addDays(day, -28));
  const { seed, claims } = traegerPageSeed([arrivalPickupTimes({ from, to })]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerArrivalPickupPage />
      </SWRServerSeed>
    </Suspense>
  );
}
