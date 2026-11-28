"use client";

// Kopie oder Verbindung (#8208): Die Schulen behalten ihre eigenen Angaben
// zur Person (ADR 0089 Abschnitt 3). Hier steht, welche Schule Name oder
// Geburtstag anders führt als die Akte, und „Für diese Schule übernehmen“
// schreibt die Angaben der Akte in genau diese Schule. moto schiebt nichts
// von selbst.

import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
  ResponsiveActionList,
  ResponsiveActionRow,
  ResponsiveRowActions,
} from "~/components/ui/responsive-action-list";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { SectionCard } from "~/components/ui/section-card";
import { useApiErrorDisplay, useToast } from "~/contexts/ToastContext";
import { formatDate } from "~/lib/date-helpers";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { createLogger } from "~/lib/logger";
import {
  adoptStaffPersonAtSchool,
  type StaffEmployment,
  type StaffPersonField,
  type StaffRecordDetail,
  type StaffSchoolPerson,
} from "~/lib/traeger-staff-api";
import { STAFF_FIELD_LABELS } from "./staff-record-format";

const logger = createLogger({ component: "TraegerStaffSchoolPersons" });

/** „Vorname „Mira“, Nachname „Sommer“, Geburtstag fehlt“ */
function schoolPersonText(person: StaffSchoolPerson): string {
  const part = (field: StaffPersonField): string => {
    if (field === "first_name") {
      return `${STAFF_FIELD_LABELS.first_name} „${person.firstName}“`;
    }
    if (field === "last_name") {
      return `${STAFF_FIELD_LABELS.last_name} „${person.lastName}“`;
    }
    return person.birthday
      ? `${STAFF_FIELD_LABELS.birthday} ${formatDate(person.birthday)}`
      : `${STAFF_FIELD_LABELS.birthday} fehlt`;
  };
  return person.fields.map(part).join(", ");
}

export function StaffSchoolPersons({
  record,
  onAdopted,
}: Readonly<{
  record: Pick<StaffRecordDetail, "id" | "personVersion" | "employments">;
  /** Lädt die Akte neu; die Liste zeigt danach den neuen Stand. */
  onAdopted: () => Promise<unknown>;
}>) {
  const [adopting, setAdopting] = useState<string | null>(null);
  const { success } = useToast();
  const { show } = useApiErrorDisplay();
  const afterWrite = useRefreshAfterWrite("die Akte", onAdopted);
  const differing = record.employments.filter(
    (
      employment,
    ): employment is StaffEmployment & {
      schoolPerson: StaffSchoolPerson;
    } => employment.schoolPerson != null,
  );
  if (differing.length === 0) return null;

  const adopt = async (employment: StaffEmployment) => {
    setAdopting(employment.schoolId);
    try {
      await adoptStaffPersonAtSchool(
        record.id,
        employment.schoolId,
        record.personVersion,
      );
    } catch (error) {
      setAdopting(null);
      logger.error("traeger_staff_school_person_adopt_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      await show(error, { object: `die Angaben für ${employment.schoolName}` });
      return;
    }
    // Übernommen. Die Liste zeigt den neuen Stand, sobald die Akte neu
    // geladen ist; scheitert nur das, sagt die Karte, dass gespeichert ist.
    const fresh = await afterWrite.refresh();
    setAdopting(null);
    if (fresh) {
      success(
        `${employment.schoolName} führt die Person jetzt mit den Angaben aus der Akte.`,
      );
    }
  };

  return (
    <SectionCard
      title="Andere Angaben an Schulen"
      description="Diese Schulen führen die Person anders als hier. moto ändert die Angaben der Schulen nicht von selbst."
      headingLevel={3}
      titleSize="sm"
      titleClassName="font-medium text-gray-600"
      bare
      className="mt-5 space-y-3"
    >
      <LoadErrorAlert error={afterWrite.error} />
      <ResponsiveActionList>
        {differing.map((employment) => (
          <ResponsiveActionRow
            key={employment.schoolId}
            className="text-sm text-gray-700"
          >
            <p className="min-w-0">
              <span className="font-medium text-gray-900">
                {employment.schoolName}
              </span>
              : {schoolPersonText(employment.schoolPerson)}
            </p>
            <ResponsiveRowActions>
              <Button
                type="button"
                variant="surface"
                size="compact"
                aria-label={`Für ${employment.schoolName} übernehmen`}
                tooltip={`Schreibt Name und Geburtstag aus der Akte sofort in die Angaben von ${employment.schoolName}. Andere Schulen bleiben gleich.`}
                isLoading={adopting === employment.schoolId}
                loadingText="Wird übernommen …"
                disabled={adopting !== null}
                disabledReason={
                  adopting !== null && adopting !== employment.schoolId
                    ? "Warte, bis die andere Übernahme gespeichert ist."
                    : undefined
                }
                onClick={() => void adopt(employment)}
              >
                Für diese Schule übernehmen
              </Button>
            </ResponsiveRowActions>
          </ResponsiveActionRow>
        ))}
      </ResponsiveActionList>
    </SectionCard>
  );
}
