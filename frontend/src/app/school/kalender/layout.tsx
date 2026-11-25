import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  schoolPageSeed,
  schoolCalendarWeek,
} from "~/lib/school/page-seed.server";

export default function PageLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { seed, claims } = schoolPageSeed([schoolCalendarWeek()]);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        {children}
      </SWRServerSeed>
    </Suspense>
  );
}
