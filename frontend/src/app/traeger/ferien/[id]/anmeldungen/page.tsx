import {
  holidayPeriod,
  holidayConfirmationSettings,
} from "~/lib/traeger/holiday-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  traegerPageSeed,
  traegerSchools,
} from "~/lib/traeger/page-seed.server";
import TraegerHolidayRegistrationsPage from "./page-content";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { seed, claims } = traegerPageSeed([
    holidayPeriod(id),
    holidayConfirmationSettings,
    traegerSchools,
  ]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerHolidayRegistrationsPage />
      </SWRServerSeed>
    </Suspense>
  );
}
