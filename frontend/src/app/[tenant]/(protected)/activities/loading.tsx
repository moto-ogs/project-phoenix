"use client";

import { TenantPage } from "~/components/ui/tenant-page";
import {
  useModuleBooked,
  usePresenceMode,
  useTenantSafe,
} from "~/lib/tenant-context";

const ACTIVITIES_INFO =
  "Hier stehen die Aktivitäten, die am Tablet zur Wahl stehen. Eine neue erstellst du mit „Aktivität erstellen“, am Handy mit dem Plus. Eine eigene Aktivität öffnest du, um sie zu ändern.";
const ACTIVITIES_OFF_INFO =
  "Hier wären die Aktivitäten für das Tablet. Deine Schule nutzt sie zurzeit nicht.";

/**
 * Route-level loading UI: dasselbe Gerüst wie die Seite, nur mit Skelett an
 * Statuszeile und Inhalt, damit die Navigation ein durchgehendes Skelett
 * zeigt statt erst der Gruppen-Ladeanzeige und dann dem Seitenskelett.
 */
export default function ActivitiesLoading() {
  const tenant = useTenantSafe()?.tenant;
  const nfcBooked = useModuleBooked("nfc_anwesenheit");
  const presenceMode = usePresenceMode();
  const disabled =
    tenant !== null &&
    tenant !== undefined &&
    (presenceMode === "binary" || !nfcBooked);

  return (
    <TenantPage
      title="Aktivitäten"
      info={disabled ? ACTIVITIES_OFF_INFO : ACTIVITIES_INFO}
      statsLoading
      loading
    />
  );
}
