"use client";

import { useCallback, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
  GradeTransitionsManager,
  type TransitionPermissions,
} from "~/components/database/grade-transitions/grade-transitions-manager";
import { DesktopOnlyNotice } from "~/components/ui/desktop-only-notice";
import { ForbiddenPage } from "~/components/ui/forbidden-page";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { hasPermission } from "~/lib/auth-utils";

/** Info-Knopf am Titel: wofür die Seite da ist und was man zuerst tut. */
const GRADE_TRANSITIONS_INFO =
  "Zum neuen Schuljahr übernimmst du hier alle Kinder in ihre nächste Klasse. moto schlägt für jede Klasse die nächste vor, du prüfst nur. Das geht am Computer, nicht am Handy.";

export default function GradeTransitionsPage() {
  const { data: session, status } = useSession();

  const permissions = useMemo<TransitionPermissions>(
    () => ({
      canCreate: hasPermission(session, "grade_transitions:create"),
      canUpdate: hasPermission(session, "grade_transitions:update"),
      canDelete: hasPermission(session, "grade_transitions:delete"),
      canApply: hasPermission(session, "grade_transitions:apply"),
      canPurge: hasPermission(session, "users:delete"),
    }),
    [session],
  );

  const canRead = hasPermission(session, "grade_transitions:read");

  // Statuszeile des Seitenkopfs: die Liste, die der Manager ohnehin lädt.
  const [summary, setSummary] = useState<{
    total: number;
    applied: number;
    latestYear: string | null;
  } | null>(null);
  const handleSummaryChange = useCallback(
    (
      next: {
        total: number;
        applied: number;
        latestYear: string | null;
      } | null,
    ) => setSummary(next),
    [],
  );
  const statusLine = (() => {
    if (!canRead) return "Kein Zugriff auf Schuljahreswechsel";
    if (!summary) return null;
    if (summary.total === 0) return "Noch kein Schuljahreswechsel angelegt";
    return (
      <TenantPageStats
        items={[
          ...(summary.latestYear
            ? [{ label: `Schuljahr ${summary.latestYear}` }]
            : []),
          { value: summary.total, label: "Wechsel" },
          { value: summary.applied, label: "angewendet" },
        ]}
      />
    );
  })();

  return (
    <TenantPage
      title="Schuljahreswechsel"
      info={GRADE_TRANSITIONS_INFO}
      stats={statusLine}
      statsLoading={statusLine === null}
      loading={status === "loading"}
      back
    >
      <DesktopOnlyNotice description="Der Schuljahreswechsel ist für die Arbeit am Computer optimiert. Bitte öffne diese Seite auf einem Laptop oder Desktop-Rechner." />

      {/* Flex-Spalte, damit die Liste als letzte Fläche bis zur Unterkante
          wächst (`.moto-tenant-body`). */}
      <div className="hidden lg:flex lg:flex-col">
        {canRead ? (
          <GradeTransitionsManager
            permissions={permissions}
            onSummaryChange={handleSummaryChange}
          />
        ) : (
          <ForbiddenPage
            embedded
            message="Du hast nicht die nötige Berechtigung, um Schuljahreswechsel anzusehen."
          />
        )}
      </div>
    </TenantPage>
  );
}
