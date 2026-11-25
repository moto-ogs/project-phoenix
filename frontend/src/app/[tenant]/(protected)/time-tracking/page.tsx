import { Suspense } from "react";
import TimeTrackingContent, { TimeTrackingPageSkeleton } from "./page-content";
import { loadTimeTrackingSeed } from "./page-seed.server";
import { TimeTrackingSeed } from "./page-seed";

export default async function TimeTrackingPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const seed = loadTimeTrackingSeed(tenant).catch(() => null);
  return (
    <Suspense fallback={<TimeTrackingPageSkeleton />}>
      <TimeTrackingSeed seed={seed}>
        <TimeTrackingContent />
      </TimeTrackingSeed>
    </Suspense>
  );
}
