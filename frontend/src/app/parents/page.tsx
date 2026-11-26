import { Suspense } from "react";
import { messageBoundary } from "~/i18n/scoped-messages";
import { ParentPageSkeleton } from "~/components/parent/parent-page";
import { ParentStartPage } from "~/components/parent/start/parent-start-page";
import { ParentPageSeed } from "~/app/parents/parent-page-seed";

export const unstable_dynamicStaleTime = 60;

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

/**
 * Die Startseite. Kinderliste, Funktionen und Tagesstatus laedt der Server
 * schon beim Rendern (#8077); beim ersten Aufruf stehen die Kinderkarten im
 * HTML, bei einem Wechsel uebernehmen die Leser die Werte statt neu zu laden.
 */
export default function ParentsStartPage() {
  // The fallback must not mount the page readers while their seed is still
  // streaming. The server already started the independent reads in parallel.
  return (
    <PageMessages>
      <Suspense fallback={<ParentPageSkeleton />}>
        <ParentPageSeed page={{ kind: "start" }}>
          <ParentStartPage />
        </ParentPageSeed>
      </Suspense>
    </PageMessages>
  );
}
