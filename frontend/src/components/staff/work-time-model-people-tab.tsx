"use client";

// Reiter „Personen“ einer Arbeitszeitmodell-Vorlage (#6921): wer die Vorlage
// nutzt, und von hier aus mehrere Personen auf einmal zuordnen. Vorher ging
// das nur Person für Person in der Personalakte.

import { useCallback, useState } from "react";
import { UserPlus } from "lucide-react";

import { Alert } from "~/components/ui/alert";
import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { FramedList } from "~/components/ui/framed-list";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { SectionLabel } from "~/components/ui/section-label";
import { SkeletonRows } from "~/components/ui/skeleton";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import {
  workTimeModelService,
  type Staff,
  type StaffWorkTimeFact,
  type WorkTimeModel,
} from "~/lib/staff-api";
import { useInvalidateMatching, useSWRAuth, useTenantMutate } from "~/lib/swr";
import { staff as staffKeys } from "~/lib/swr/staff";
import { workTimeModelKeys } from "~/lib/swr/staff-keys";

import { isStaleAfterModelSave } from "./arbeitszeit-hours";
import { WorkTimeModelAssignDialog } from "./work-time-model-assign-dialog";
import {
  assignmentPeople,
  peopleCount,
} from "./work-time-model-assignment-helpers";

/** Nach einer Zuordnung: das Soll und der Reiter jeder Person laden neu. */
function isStaleAfterAssignment(key: unknown): boolean {
  return (
    isStaleAfterModelSave(key) ||
    (typeof key === "string" && key.includes("staff-schedule-"))
  );
}

export interface WorkTimeModelPeopleTabProps {
  readonly model: WorkTimeModel;
}

export function WorkTimeModelPeopleTab({ model }: WorkTimeModelPeopleTabProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const tenantMutate = useTenantMutate();
  const invalidate = useInvalidateMatching();
  // Derselbe Schlüssel wie die Katalogseite: die Liste ist schon geladen und
  // nennt die Vorlagen, die andere Personen nutzen.
  const { data: models } = useSWRAuth<WorkTimeModel[]>(
    workTimeModelKeys.catalog(),
    () => workTimeModelService.listWithUsage(),
  );
  const {
    data: staff,
    error: staffError,
    mutate: reloadStaff,
  } = useSWRAuth<Staff[]>(
    staffKeys.key({}, { strict: true }),
    // strict: eine fehlgeschlagene Liste ist ein Fehler, keine leere Schule.
    () => staffKeys.fetcher({}, { strict: true }),
  );
  const {
    data: facts,
    error: factsError,
    mutate: reloadFacts,
  } = useSWRAuth<StaffWorkTimeFact[]>(workTimeModelKeys.staffFacts(), () =>
    workTimeModelService.staffFacts(),
  );
  const staffLoadError = useSwrLoadError(staffError, "die Personen", () =>
    reloadStaff(),
  );
  const factsLoadError = useSwrLoadError(factsError, "die Zuordnungen", () =>
    reloadFacts(),
  );

  // Eine Zuordnung ändert die Nutzungszahl, die Zuordnungen und das Soll
  // der neu zugeordneten Personen.
  const onAssigned = useCallback(
    () =>
      Promise.all([
        tenantMutate(workTimeModelKeys.catalog()),
        reloadFacts(),
        invalidate(isStaleAfterAssignment),
      ]),
    [tenantMutate, reloadFacts, invalidate],
  );

  const loaded = staff !== undefined && facts !== undefined;
  const people = loaded
    ? assignmentPeople(staff, facts, models ?? [], model.id)
    : { assignees: [], candidates: [] };
  const archived = model.archivedAt !== null;
  const loadFailed = staffLoadError !== null || factsLoadError !== null;

  let assignDisabledReason: string | undefined;
  if (archived) {
    assignDisabledReason =
      "Die Vorlage wird nicht mehr angeboten. Bieten Sie sie zuerst wieder an.";
  } else if (!loaded && !loadFailed) {
    assignDisabledReason = "Die Personen werden noch geladen.";
  } else if (!loaded) {
    assignDisabledReason = "Die Personen konnten nicht geladen werden.";
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <SectionLabel as="h3">Personen mit dieser Vorlage</SectionLabel>
          <p className="mt-1 text-sm text-gray-600" data-testid="people-count">
            {loaded
              ? people.assignees.length === 0
                ? "Noch niemand nutzt diese Vorlage."
                : `${peopleCount(people.assignees.length)} ${people.assignees.length === 1 ? "nutzt" : "nutzen"} diese Vorlage.`
              : "Wird geladen…"}
          </p>
        </div>
        <Button
          type="button"
          variant="primary"
          size="md"
          className="gap-2"
          onClick={() => setDialogOpen(true)}
          disabled={assignDisabledReason !== undefined}
          disabledReason={assignDisabledReason}
          tooltip="Öffnet die Auswahl. Gespeichert wird erst nach Ihrer Bestätigung."
        >
          <UserPlus className="size-4" aria-hidden="true" />
          Personen zuordnen
        </Button>
      </div>

      {archived ? (
        <Alert
          type="info"
          size="compact"
          message="Diese Vorlage wird nicht mehr angeboten. Wer sie nutzt, behält sie und ihr Soll."
        />
      ) : null}
      <LoadErrorAlert error={staffLoadError} />
      <LoadErrorAlert error={factsLoadError} />

      {!loaded ? (
        loadFailed ? null : (
          <SkeletonRows rows={3} labelClassName="w-8" />
        )
      ) : people.assignees.length === 0 ? (
        <EmptyState
          variant="dashed"
          titleAs="p"
          title="Noch niemand nutzt diese Vorlage."
          description={
            archived
              ? "Eine Vorlage, die nicht mehr angeboten wird, lässt sich nicht neu zuordnen."
              : "Mit „Personen zuordnen“ wählen Sie, für wen ihr Soll gilt."
          }
        />
      ) : (
        <FramedList maxHeight="lg">
          {people.assignees.map((person) => (
            <li key={person.id} className="flex items-center gap-3 px-3 py-2">
              <Avatar
                name={person.name}
                imageUrl={person.avatarUrl}
                size="sm"
                decorative
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-900">
                  {person.name}
                </span>
                {person.role ? (
                  <span className="block truncate text-sm text-gray-500">
                    {person.role}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </FramedList>
      )}

      {loaded && !archived ? (
        <WorkTimeModelAssignDialog
          isOpen={dialogOpen}
          model={model}
          candidates={people.candidates}
          onClose={() => setDialogOpen(false)}
          onAssigned={onAssigned}
        />
      ) : null}
    </div>
  );
}
