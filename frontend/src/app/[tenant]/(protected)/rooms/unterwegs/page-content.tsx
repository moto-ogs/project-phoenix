"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BinaryModeGuard } from "~/components/tenant/binary-mode-guard";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { TenantPage } from "~/components/ui/tenant-page";
import { TransitStudentsSection } from "~/components/rooms/transit-students-section";
import {
  CHILD_OVERVIEW_PATH,
  transitDayStatusFromReferrer,
  transitReferrer as readTransitReferrer,
} from "./transit-selection";
import { transitConcept } from "~/lib/concepts/transit";
import TransitLoading from "./loading";

const TRANSIT_INFO =
  "Hier stehen Kinder, die da sind, aber in keinem Raum. Darfst du sie zuweisen, wählst du sie aus und setzt sie in einen Raum.";
const TRANSIT_BINARY_MODE_INFO =
  "Hier wären Kinder, die da sind, aber in keinem Raum. Deine Schule nutzt das zurzeit nicht.";

/** Der Rückweg der Kindakte aus dieser Liste. */
const TRANSIT_PATH = "/rooms/unterwegs";

/**
 * Kinder ohne Raumzuweisung (#3115). Bis dahin ein Slide-over auf /rooms
 * („Unterwegs"); jetzt eine Seite wie jeder Raum, damit „Zurück", ein
 * geteilter Link und ein Neuladen dort landen, wo man war.
 */
export default function TransitPage() {
  return (
    <BinaryModeGuard title="Unterwegs" info={TRANSIT_BINARY_MODE_INFO}>
      <Suspense fallback={<TransitLoading />}>
        <TransitPageContent />
      </Suspense>
    </BinaryModeGuard>
  );
}

function TransitPageContent() {
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const searchParams = useSearchParams();
  const referrer = readTransitReferrer(searchParams.get("from"));
  const backLabel = referrer.startsWith(CHILD_OVERVIEW_PATH)
    ? "Zurück zur Kinderübersicht"
    : "Zurück zu den Räumen";
  const transitDayStatus = referrer.startsWith(CHILD_OVERVIEW_PATH)
    ? transitDayStatusFromReferrer(referrer)
    : undefined;
  const transitReferrer = `${TRANSIT_PATH}?from=${encodeURIComponent(referrer)}`;

  return (
    <TenantPage
      title="Unterwegs"
      info={TRANSIT_INFO}
      stats={
        totalCount === null
          ? undefined
          : `${totalCount} ${totalCount === 1 ? "Kind" : "Kinder"}`
      }
      statsLoading={totalCount === null}
      back
      backHref={referrer}
      backLabel={backLabel}
      leading={<MotoConceptIcon concept={transitConcept} size={40} />}
    >
      <TransitStudentsSection
        dayStatus={transitDayStatus}
        fromReferrer={transitReferrer}
        onTotalCountChange={setTotalCount}
      />
    </TenantPage>
  );
}
