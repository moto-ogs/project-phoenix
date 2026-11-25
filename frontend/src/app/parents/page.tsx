import { Suspense } from "react";
import { messageBoundary } from "~/i18n/scoped-messages";
import { ParentServerSeed } from "~/components/parent/parent-server-seed";
import { ParentStartPage } from "~/components/parent/start/parent-start-page";
import { parentSeedProps } from "~/lib/parent-seed.server";

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
  // Until the seed is there, the server HTML shows the page itself with its
  // card skeleton: greeting, holiday offers and to-dos do not wait for it.
  // A client navigation never suspends here.
  return (
    <PageMessages>
      <Suspense fallback={<ParentStartPage />}>
        <ParentServerSeed {...parentSeedProps(true)}>
          <ParentStartPage />
        </ParentServerSeed>
      </Suspense>
    </PageMessages>
  );
}
