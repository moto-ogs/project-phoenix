import {
  holidayPeriod,
  holidayConfirmationSettings,
} from "~/lib/traeger/holiday-seed-reads.server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { traegerPageSeed } from "~/lib/traeger/page-seed.server";
import TraegerHolidayRegistrationPage from "./page-content";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { seed, claims } = traegerPageSeed([
    holidayPeriod(id),
    holidayConfirmationSettings,
  ]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <TraegerHolidayRegistrationPage />
      </SWRServerSeed>
    </Suspense>
  );
}
