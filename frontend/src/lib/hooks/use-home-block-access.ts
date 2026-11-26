"use client";

import { useMemo } from "react";
import { useSession } from "next-auth/react";

import { homeBlockAccess } from "~/lib/home-block-access";
import type { HomeBlockAccess } from "~/lib/home-blocks";
import { useOptionalSupervision } from "~/lib/supervision-context";
import { useOperationalOverviewScope } from "~/lib/tenant-context";

/**
 * Die Rechte der angemeldeten Person in der Form, die der Bausteinkatalog der
 * Startseite erwartet (#2180).
 *
 * Bewusst keine Rollennamen: Rollen sind pro Schule frei anlegbar, eine
 * selbst angelegte Rolle muss ohne Codeänderung eine brauchbare Startseite
 * bekommen. Deshalb entscheidet ausschliesslich das Recht, an dem auch der
 * Endpunkt hinter dem Baustein hängt. Was hier durchkommt, prüft der Server
 * anschliessend noch einmal selbst.
 *
 * Zwei Angaben sind keine Rechte, sondern Zuschnitt: ob die Person selbst
 * betreut (Basisrolle `user`/`teacher`) und ob sie heute eine eigene Gruppe
 * hat. Beides entscheidet nur, welche Standardansicht sie bekommt und ob
 * „Meine Gruppe" etwas zu zeigen hätte.
 */
export function useHomeBlockAccess(): HomeBlockAccess {
  const { data: session } = useSession();
  const { groups } = useOptionalSupervision();
  // Die Übersicht kann auch fremde Gruppen der Schule enthalten. Nur das
  // personengebundene Kennzeichen öffnet die Karte „Meine Gruppe“.
  const hasOwnGroups = groups.some((group) => group.is_personal === true);

  const overviewScope = useOperationalOverviewScope();

  return useMemo(
    () => homeBlockAccess(session, hasOwnGroups, overviewScope),
    [session, hasOwnGroups, overviewScope],
  );
}
