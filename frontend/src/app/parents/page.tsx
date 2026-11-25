import { messageBoundary } from "~/i18n/scoped-messages";
import { ParentStartPage } from "~/components/parent/start/parent-start-page";

const PageMessages = messageBoundary(
  "holidayRegistration.weekRange",
  "parentChild.today.pickupLabel",
  "parentChild.today.pickup",
  "parentDashboard",
  "parentDeclaration",
  "parentHolidayRegistrations.card",
  "parentHolidayRegistrations.status",
  "parentNav",
  "parentStart",
  "parentToday",
  "surveyForm",
);

export default function ParentsStartPage() {
  return (
    <PageMessages>
      <ParentStartPage />
    </PageMessages>
  );
}
