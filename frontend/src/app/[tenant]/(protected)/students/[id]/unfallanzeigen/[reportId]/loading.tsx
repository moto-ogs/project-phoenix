"use client";

import { useParams } from "next/navigation";
import { TenantPage } from "~/components/ui/tenant-page";

const ACCIDENT_REPORT_INFO =
  "Hier steht die Unfallanzeige zu einem Unfall dieses Kindes. Unterschrieben wird sie unter „Unterschrift der Leitung“. Danach gibst du das PDF selbst an die Unfallkasse weiter.";

/**
 * Route-level loading UI: the report page's own frame while it loads, so the
 * child profile's skeleton does not flash in between.
 */
export default function AccidentReportLoading() {
  const params = useParams();
  return (
    <TenantPage
      title="Unfallanzeige"
      info={ACCIDENT_REPORT_INFO}
      back
      backHref={`/students/${String(params.id)}?tab=dokumente`}
      backLabel="Zurück zum Kinderprofil"
      loading
    />
  );
}
