import { ParentPageSkeleton } from "~/components/parent/parent-page";
import { Suspense } from "react";
import { ParentPageSeed } from "~/app/parents/parent-page-seed";
import { messageBoundary } from "~/i18n/scoped-messages";
import { ParentHolidayRegistrationsPage } from "~/components/parent/parent-holiday-registrations-page";

const PageMessages = messageBoundary(
  "holidayRegistration.placementPlaced",
  "holidayRegistration.placementWaitlisted",
  "holidayRegistration.placementPending",
  "holidayRegistration.pendingNote",
  "holidayRegistration.waitlistNote",
  "holidayRegistration.weekRange",
  "holidayRegistration.summaryLunch",
  "parentHolidayRegistrations",
  "parentNav",
);

export default function ParentsHolidayRegistrationsPage() {
  return (
    <PageMessages>
      <Suspense fallback={<ParentPageSkeleton rows={2} />}>
        <ParentPageSeed page={{ kind: "holiday" }}>
          <ParentHolidayRegistrationsPage />
        </ParentPageSeed>
      </Suspense>
    </PageMessages>
  );
}
