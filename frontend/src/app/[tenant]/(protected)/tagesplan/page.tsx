"use client";

// Tages-Betreuungsplan (#2383): mobiler Einstieg der Betreuungskräfte in den
// laufenden Betreuungstag. Im binären Anwesenheitsmodus gibt es keine Raum-
// oder Modulsteuerung, deshalb greift der BinaryModeGuard vor allem anderen.

import { Suspense } from "react";

import { BinaryModeGuard } from "~/components/tenant/binary-mode-guard";
import {
  TagesplanView,
  TAGESPLAN_DISABLED_INFO,
} from "~/components/timetable/tagesplan-view";
import { STAFF_FLAT_PAGES } from "~/lib/section-navigation";

export default function TagesplanPage() {
  return (
    <BinaryModeGuard
      title={STAFF_FLAT_PAGES.tagesplan.label}
      info={TAGESPLAN_DISABLED_INFO}
    >
      <Suspense fallback={null}>
        <TagesplanView />
      </Suspense>
    </BinaryModeGuard>
  );
}
