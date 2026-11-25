import { messageBoundary } from "~/i18n/scoped-messages";
import { Suspense } from "react";
import { ParentCalendarPage } from "~/components/parent/calendar/parent-calendar-page";
import { ParentPageSkeleton } from "~/components/parent/parent-page";

const PageMessages = messageBoundary(
  "parentCalendar",
  "parentCalendarSubscribe",
  "parentNav",
);

export default function ParentsCalendarPage() {
  return (
    <PageMessages>
      <Suspense fallback={<ParentPageSkeleton rows={2} />}>
        <ParentCalendarPage />
      </Suspense>
    </PageMessages>
  );
}
