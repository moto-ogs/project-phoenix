import { connection } from "next/server";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  schoolPageSeed,
  schoolCalendarWeek,
} from "~/lib/school/page-seed.server";

export default async function PageLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await connection();
  const { seed, claims } = schoolPageSeed([schoolCalendarWeek()]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        {children}
      </SWRServerSeed>
    </Suspense>
  );
}
