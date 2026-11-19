"use client";

import { TenantPage } from "~/components/ui/tenant-page";
import { ListSkeleton, SkeletonRegion } from "~/components/ui/page-skeletons";
import { usePresenceMode } from "~/lib/tenant-context";

const TRANSIT_INFO =
  "Hier stehen Kinder, die da sind, aber in keinem Raum. Darfst du sie zuweisen, wählst du sie aus und setzt sie in einen Raum.";
const TRANSIT_BINARY_MODE_INFO =
  "Hier wären Kinder, die da sind, aber in keinem Raum. Deine Schule nutzt das zurzeit nicht.";

export default function TransitLoading() {
  const info =
    usePresenceMode() === "binary" ? TRANSIT_BINARY_MODE_INFO : TRANSIT_INFO;

  return (
    <TenantPage
      title="Unterwegs"
      info={info}
      statsLoading
      back
      backHref="/rooms"
      backLabel="Zurück zu den Räumen"
    >
      <SkeletonRegion label="Kinder ohne Raum werden geladen">
        <ListSkeleton rows={4} avatar={false} />
      </SkeletonRegion>
    </TenantPage>
  );
}
