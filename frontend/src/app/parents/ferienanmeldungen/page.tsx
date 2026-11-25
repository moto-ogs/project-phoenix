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
      <ParentHolidayRegistrationsPage />
    </PageMessages>
  );
}
