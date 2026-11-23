"use client";

import { StatusBadge } from "~/components/ui/status-badge";
import { bffJson } from "~/lib/bff-fetch";
import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Trash2 } from "lucide-react";
import { Alert } from "~/components/ui/alert";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { Button } from "~/components/ui/button";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { CustomSelect } from "~/components/ui/custom-select";
import { ConfirmationModal } from "~/components/ui/modal";
import { InfoSection } from "~/components/ui/info-section";
import { MotoDuotoneIcon } from "~/components/ui/moto-duotone-icon";
import {
  OverflowMenu,
  type OverflowMenuEntry,
} from "~/components/ui/page-header/OverflowMenu";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import type {
  BlockerActivity,
  BlockerGroup,
  BlockerSubstitution,
  BlockerSupervision,
  CaregiverCapabilityState,
} from "~/lib/caregiver-capability-api";
import { fetchGroupLeaderCandidates } from "~/lib/staff-role-api";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { isChangedSinceRead } from "~/lib/api-error";
import { useSWRAuth } from "~/lib/swr";
import { groups as groupsKeys } from "~/lib/swr/groups";
import { staffAccessKeys } from "~/lib/swr/staff-keys";
import { activitiesConcept } from "~/lib/concepts/activities";
import { groupAccessConcept } from "~/lib/concepts/groupAccess";
import { groupsConcept } from "~/lib/concepts/groups";
import { supervisionConcept } from "~/lib/concepts/supervision";
import { InsetPanel } from "~/components/ui/inset-panel";

const logger = createLogger({ component: "CaregiverBlockerResolution" });

interface CaregiverBlockerResolutionPanelProps {
  /** Der Schritt ist sichtbar; beim Aktivieren wird die Vertretungsliste geladen. */
  readonly active: boolean;
  readonly state: CaregiverCapabilityState;
  readonly onConfirmationVisibilityChange?: (visible: boolean) => void;
}

async function endActiveSupervision(id: string): Promise<void> {
  await bffJson("tenant", "POST /api/active/supervisors/{id}/end", {
    params: { id },
    errorMessage: "End supervision failed",
  });
}

async function endGroupHandover(id: string): Promise<void> {
  await bffJson("tenant", "POST /api/substitutions/end", {
    body: { type: "group_handover", id },
    errorMessage: "End group handover failed",
  });
}

async function removeActivitySupervisor(
  activityId: string,
  supervisorId: string,
  replacementStaffId?: string,
): Promise<void> {
  // Code (etwa timetable.only_supervisor_replacement_required), Felder und
  // Vorgangskennung reisen mit; der Text ist nur Diagnose.
  await bffJson(
    "tenant",
    "DELETE /api/activities/{id}/supervisors/{supervisorId}",
    {
      params: { id: activityId, supervisorId },
      query: { replacement_staff_id: replacementStaffId || undefined },
      errorMessage: "Remove activity supervisor failed",
    },
  );
}

/** The stored group a resolution starts from (ADR 0311). */
interface StoredGroup {
  readonly name: string;
  readonly teacherIds: string[];
  readonly version?: string;
}

// The route keeps the group's room: the body names no room (ADR 0311).
async function updateGroupTeachers(
  groupId: string,
  stored: StoredGroup,
  teacherIds: string[],
): Promise<void> {
  await bffJson("tenant", "PUT /api/groups/{id}", {
    params: { id: groupId },
    body: {
      name: stored.name,
      teacher_ids: teacherIds,
      expected_version: stored.version,
    },
    errorMessage: "Update group teachers failed",
  });
}

const GROUP_LIST = { page: 1, pageSize: 500 } as const;

function buildUpdatedTeacherIds(
  group: BlockerGroup,
  replacementTeacherId?: string,
): string[] {
  const currentTeacherIds =
    group.teacherIds.length > 0 ? group.teacherIds : [group.teacherId];
  const nextTeacherIds = currentTeacherIds.filter(
    (id) => id !== group.teacherId,
  );

  if (replacementTeacherId && !nextTeacherIds.includes(replacementTeacherId)) {
    nextTeacherIds.push(replacementTeacherId);
  }

  return nextTeacherIds;
}

/**
 * Zweiter Schritt IM Dialog „Betreuung verwalten" — kein eigener Dialog:
 * ein Modal über einem Modal ist portalweit verboten (Bauart 2, Regel 3).
 */
export function CaregiverBlockerResolutionPanel({
  active,
  state,
  onConfirmationVisibilityChange,
}: CaregiverBlockerResolutionPanelProps) {
  const { success: toastSuccess } = useToast();
  const {
    data: candidates,
    error: candidatesError,
    mutate: reloadCandidates,
  } = useSWRAuth(
    active ? staffAccessKeys.groupLeaderCandidates() : null,
    fetchGroupLeaderCandidates,
  );
  const availableStaff = useMemo(
    () => (candidates ?? []).filter((s) => s.id !== state.staffId),
    [candidates, state.staffId],
  );
  const loadingStaff = active && !candidates && !candidatesError;
  // Ladefehler der Ersatzkräfte vor Ort, Fehler beim Auflösen im Panel des
  // Dialogs, beide mit Katalogtext (#2517).
  const { error: staffLoadError } = useSwrResourceLoadError(
    [{ data: candidates, error: candidatesError }],
    "die Liste der Ersatzkräfte",
    () => reloadCandidates(),
  );

  const [supervisions, setSupervisions] = useState<BlockerSupervision[]>([]);
  const [substitutions, setSubstitutions] = useState<BlockerSubstitution[]>([]);
  const [activities, setActivities] = useState<BlockerActivity[]>([]);
  const [groups, setGroups] = useState<BlockerGroup[]>([]);

  const [activityReplacements, setActivityReplacements] = useState<
    Record<string, string>
  >({});
  const [groupReplacements, setGroupReplacements] = useState<
    Record<string, string>
  >({});

  // The groups as stored when the step opened: a resolution keeps their
  // other leads and sends the version read (ADR 0311). A group read again
  // after a refusal starts from the stored state.
  const storedGroupList = useSWRAuth(
    active && state.groupAssignments.length > 0
      ? groupsKeys.key(GROUP_LIST)
      : null,
    () => groupsKeys.fetcher(GROUP_LIST),
  );
  const { error: groupLoadError } = useSwrResourceLoadError(
    [{ data: storedGroupList.data, error: storedGroupList.error }],
    "die Stammgruppen",
    () => storedGroupList.mutate(),
  );
  const [storedGroups, setStoredGroups] = useState<Record<string, StoredGroup>>(
    {},
  );
  const unread = storedGroupList.data
    ? groups.filter((item) => !(item.groupId in storedGroups))
    : [];
  if (storedGroupList.data && unread.length > 0) {
    const next = { ...storedGroups };
    for (const item of unread) {
      const group = storedGroupList.data.find((g) => g.id === item.groupId);
      if (group)
        next[item.groupId] = {
          name: group.name,
          teacherIds: group.teacher_ids ?? [],
          version: group.version,
        };
    }
    if (Object.keys(next).length > Object.keys(storedGroups).length)
      setStoredGroups(next);
  }

  const [processing, setProcessing] = useState<Record<string, boolean>>({});
  const actionErrors = useApiFormError();
  const { clear: clearActionErrors } = actionErrors;
  // Entfernen ohne Ersatz und das Beenden einer Übergabe laufen erst nach der
  // Rückfrage (Bauart 2 Regel 6, #3109). Ein Übertragen an eine Ersatzkraft
  // läuft direkt: die Zuordnung bleibt bestehen, nur die Person wechselt.
  const [pendingRemoval, setPendingRemoval] = useState<
    | { readonly kind: "supervision"; readonly item: BlockerSupervision }
    | { readonly kind: "substitution"; readonly item: BlockerSubstitution }
    | { readonly kind: "activity"; readonly item: BlockerActivity }
    | { readonly kind: "group"; readonly item: BlockerGroup }
    | null
  >(null);
  const pendingKey =
    pendingRemoval === null
      ? null
      : pendingRemoval.kind === "supervision"
        ? `sup-${pendingRemoval.item.id}`
        : pendingRemoval.kind === "substitution"
          ? `sub-${pendingRemoval.item.id}`
          : pendingRemoval.kind === "activity"
            ? `act-${pendingRemoval.item.id}`
            : `grp-${pendingRemoval.item.id}`;
  const pendingProcessing =
    pendingKey !== null && processing[pendingKey] === true;

  const openConfirmation = (
    nextPendingRemoval: Exclude<typeof pendingRemoval, null>,
  ) => {
    onConfirmationVisibilityChange?.(true);
    setPendingRemoval(nextPendingRemoval);
  };

  const closeConfirmation = () => {
    onConfirmationVisibilityChange?.(false);
    setPendingRemoval(null);
  };

  const resolveActivity = (item: BlockerActivity) => {
    if (activityReplacements[item.id]) {
      void handleResolveActivity(item);
      return;
    }
    openConfirmation({ kind: "activity", item });
  };

  // Zeilenaktionen nur im Kebab der Zeile (BAUARTEN-SPEC Bauart 1 Regel 4).
  // Übertragen braucht eine gewählte Ersatzkraft, Entfernen setzt „Ohne
  // Ersatz entfernen" in der Auswahl voraus: die Handler lesen die Auswahl,
  // deshalb ist je nach Auswahl genau ein Eintrag verfügbar. Entfernen fragt
  // weiter im ConfirmDeleteModal nach.
  const buildResolutionMenu = (
    hasReplacement: boolean,
    busy: boolean,
    resolve: () => void,
  ): OverflowMenuEntry[] =>
    hasReplacement
      ? [
          {
            label: "Übertragen",
            description:
              "Übergibt die Leitung sofort an die gewählte Ersatzkraft.",
            icon: <ArrowRightLeft className="h-4 w-4" aria-hidden />,
            disabled: busy,
            onClick: resolve,
          },
        ]
      : [
          {
            label: "Entfernen",
            description:
              "Entfernt die Leitung ohne Ersatz, moto fragt vorher nach.",
            icon: <Trash2 className="h-4 w-4" aria-hidden />,
            destructive: true,
            disabled: busy,
            onClick: resolve,
          },
        ];

  const resolveGroup = (item: BlockerGroup) => {
    if (groupReplacements[item.id]) {
      void handleResolveGroup(item);
      return;
    }
    openConfirmation({ kind: "group", item });
  };

  const confirmPendingRemoval = async () => {
    if (!pendingRemoval) return;
    if (pendingRemoval.kind === "supervision") {
      await handleEndSupervision(pendingRemoval.item);
    } else if (pendingRemoval.kind === "substitution") {
      await handleEndSubstitution(pendingRemoval.item);
    } else if (pendingRemoval.kind === "activity") {
      await handleResolveActivity(pendingRemoval.item);
    } else {
      await handleResolveGroup(pendingRemoval.item);
    }
    // Fehler stehen im Alert des Panels; der Dialog schließt in beiden Fällen.
    closeConfirmation();
  };

  const totalRemaining =
    supervisions.length +
    substitutions.length +
    activities.length +
    groups.length;

  useEffect(() => {
    if (!active) return;
    setSupervisions(state.activeSupervisions);
    setSubstitutions(state.activeSubstitutions);
    setActivities(state.activitySupervisions);
    setGroups(state.groupAssignments);
    setActivityReplacements({});
    setGroupReplacements({});
    setStoredGroups({});
    clearActionErrors();
  }, [active, state, clearActionErrors]);

  function setItemProcessing(key: string, value: boolean) {
    setProcessing((prev) => ({ ...prev, [key]: value }));
  }

  async function handleEndSupervision(item: BlockerSupervision) {
    const key = `sup-${item.id}`;
    try {
      setItemProcessing(key, true);
      actionErrors.clear();
      await endActiveSupervision(item.id);
      setSupervisions((prev) => prev.filter((s) => s.id !== item.id));
      toastSuccess(`Die Gruppenaufsicht für „${item.groupName}“ ist beendet.`);
    } catch (error) {
      logger.error("failed to end supervision", {
        id: item.id,
        error: String(error),
      });
      void actionErrors.show(error, {
        object: `das Beenden der Aufsicht für „${item.groupName}“`,
        retry: () => void handleEndSupervision(item),
      });
    } finally {
      setItemProcessing(key, false);
    }
  }

  async function handleEndSubstitution(item: BlockerSubstitution) {
    const key = `sub-${item.id}`;
    try {
      setItemProcessing(key, true);
      actionErrors.clear();
      await endGroupHandover(item.id);
      setSubstitutions((prev) => prev.filter((s) => s.id !== item.id));
      toastSuccess(`Die Gruppenübergabe für „${item.groupName}“ ist beendet.`);
    } catch (error) {
      logger.error("failed to end substitution", {
        id: item.id,
        error: String(error),
      });
      void actionErrors.show(error, {
        object: `das Beenden der Übergabe für „${item.groupName}“`,
        retry: () => void handleEndSubstitution(item),
      });
    } finally {
      setItemProcessing(key, false);
    }
  }

  async function handleResolveActivity(item: BlockerActivity) {
    const replacementStaffId = activityReplacements[item.id];
    const key = `act-${item.id}`;
    try {
      setItemProcessing(key, true);
      actionErrors.clear();
      await removeActivitySupervisor(
        item.activityId,
        item.id,
        replacementStaffId,
      );
      setActivities((prev) => prev.filter((a) => a.id !== item.id));
      toastSuccess(
        replacementStaffId
          ? `Die Leitung von „${item.activityName}“ ist übertragen.`
          : `Die Leitung von „${item.activityName}“ ist entfernt.`,
      );
    } catch (error) {
      logger.error("failed to resolve activity", {
        id: item.id,
        error: String(error),
      });
      // timetable.only_supervisor_replacement_required (einzige Leitung)
      // erklärt der Katalog.
      void actionErrors.show(error, {
        object: `die Leitung von „${item.activityName}“`,
        retry: () => void handleResolveActivity(item),
      });
    } finally {
      setItemProcessing(key, false);
    }
  }

  async function handleResolveGroup(item: BlockerGroup) {
    const replacementStaffId = groupReplacements[item.id];
    const key = `grp-${item.id}`;
    try {
      setItemProcessing(key, true);
      actionErrors.clear();
      const replacementTeacherId = replacementStaffId
        ? availableStaff.find((staff) => staff.id === replacementStaffId)
            ?.teacherId
        : undefined;
      if (replacementStaffId && !replacementTeacherId) {
        actionErrors.invalid(
          "Diese Ersatzkraft kann keine Stammgruppe leiten. Bitte wähle eine andere Person.",
        );
        return;
      }
      const stored = storedGroups[item.groupId];
      if (!stored) return;
      const newTeacherIds = buildUpdatedTeacherIds(
        { ...item, teacherIds: stored.teacherIds },
        replacementTeacherId,
      );
      await updateGroupTeachers(item.groupId, stored, newTeacherIds);
      setGroups((prev) => prev.filter((g) => g.id !== item.id));
      toastSuccess(
        replacementStaffId
          ? `Die Gruppenleitung für „${item.groupName}“ ist übertragen.`
          : `Die Gruppenleitung für „${item.groupName}“ ist entfernt.`,
      );
    } catch (error) {
      logger.error("failed to resolve group", {
        id: item.id,
        error: String(error),
      });
      // Changed since it was read: read the group again; the same request
      // would be refused again, so no retry (ADR 0311).
      const changed = isChangedSinceRead(error);
      if (changed) {
        setStoredGroups((prev) => {
          const next = { ...prev };
          delete next[item.groupId];
          return next;
        });
        void storedGroupList.mutate();
      }
      void actionErrors.show(error, {
        object: `die Gruppenleitung für „${item.groupName}“`,
        retry: changed ? undefined : () => void handleResolveGroup(item),
      });
    } finally {
      setItemProcessing(key, false);
    }
  }

  return (
    <div className="space-y-4">
      {totalRemaining === 0 ? (
        <Alert
          type="success"
          message="Alle Zuordnungen wurden aufgelöst. Gehe zurück zur Übersicht, um die Betreuung zu deaktivieren."
        />
      ) : (
        <p className="text-sm text-gray-600">
          Löse die folgenden Zuordnungen auf, um die Betreuung deaktivieren zu
          können. Du kannst Zuordnungen entfernen oder an andere
          Betreuungskräfte übertragen.
        </p>
      )}

      {/* Active supervisions */}
      {supervisions.length > 0 ? (
        <InfoSection
          title={`Aktive Gruppenaufsichten (${supervisions.length})`}
          icon={
            <MotoDuotoneIcon
              icon={supervisionConcept.icon}
              tone={supervisionConcept.tone}
              size={18}
            />
          }
        >
          <div className="space-y-2">
            {supervisions.map((item) => {
              const key = `sup-${item.id}`;
              return (
                <InsetPanel
                  key={item.id}
                  tone="white"
                  padding="compact"
                  className="flex items-center justify-between"
                >
                  <div>
                    <span className="text-sm font-medium text-gray-900">
                      {item.groupName}
                    </span>
                    <span className="ml-2 text-xs text-gray-500">
                      seit {item.startDate}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline_danger"
                    size="compact"
                    onClick={() =>
                      openConfirmation({ kind: "supervision", item })
                    }
                    tooltip="Beendet die Aufsicht über diese Gruppe, moto fragt vorher nach."
                    isLoading={processing[key]}
                    loadingText="Wird beendet…"
                  >
                    Beenden
                  </Button>
                </InsetPanel>
              );
            })}
          </div>
        </InfoSection>
      ) : null}

      {/* Active group handovers */}
      {substitutions.length > 0 ? (
        <InfoSection
          title={`Aktive Gruppenübergaben (${substitutions.length})`}
          icon={
            <MotoDuotoneIcon
              icon={groupAccessConcept.icon}
              tone={groupAccessConcept.tone}
              size={18}
            />
          }
        >
          <div className="space-y-2">
            {substitutions.map((item) => {
              const key = `sub-${item.id}`;
              return (
                <InsetPanel
                  key={item.id}
                  tone="white"
                  padding="compact"
                  className="flex items-center justify-between"
                >
                  <div>
                    <span className="text-sm font-medium text-gray-900">
                      {item.groupName}
                    </span>
                    <span className="ml-2 text-xs text-gray-500">
                      {item.startDate} – {item.endDate}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline_danger"
                    size="compact"
                    onClick={() =>
                      openConfirmation({ kind: "substitution", item })
                    }
                    tooltip="Gibt die Gruppe an ihre Leitung zurück, moto fragt vorher nach."
                    isLoading={processing[key]}
                    loadingText="Wird beendet…"
                  >
                    Beenden
                  </Button>
                </InsetPanel>
              );
            })}
          </div>
        </InfoSection>
      ) : null}

      {/* Activity supervisions */}
      {activities.length > 0 ? (
        <InfoSection
          title={`Aktivitätsleitungen (${activities.length})`}
          icon={
            <MotoDuotoneIcon
              icon={activitiesConcept.icon}
              tone={activitiesConcept.tone}
              size={18}
            />
          }
        >
          <div className="space-y-2">
            {activities.map((item) => {
              const key = `act-${item.id}`;
              return (
                <InsetPanel
                  key={item.id}
                  tone="white"
                  padding="compact"
                  className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-gray-900">
                      {item.activityName}
                    </span>
                    {item.isPrimary ? (
                      <span className="ml-2 inline-flex">
                        <StatusBadge
                          label="Hauptleitung"
                          tone="orange"
                          compact
                        />
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <CustomSelect
                      ariaLabel={`Ersatz für ${item.activityName}`}
                      value={activityReplacements[item.id] ?? ""}
                      onChange={(next) =>
                        setActivityReplacements((prev) => ({
                          ...prev,
                          [item.id]: next,
                        }))
                      }
                      options={[
                        { value: "", label: "Ohne Ersatz entfernen" },
                        ...availableStaff.map((staff) => ({
                          value: staff.id,
                          label: staff.fullName,
                        })),
                      ]}
                      disabled={loadingStaff || processing[key]}
                    />
                    <OverflowMenu
                      ariaLabel={`Aktionen für ${item.activityName}`}
                      items={buildResolutionMenu(
                        Boolean(activityReplacements[item.id]),
                        processing[key] === true,
                        () => resolveActivity(item),
                      )}
                    />
                  </div>
                </InsetPanel>
              );
            })}
          </div>
        </InfoSection>
      ) : null}

      {/* Group-teacher assignments */}
      {groups.length > 0 ? (
        <InfoSection
          title={`Stammgruppen-Zuordnungen (${groups.length})`}
          icon={
            <MotoDuotoneIcon
              icon={groupsConcept.icon}
              tone={groupsConcept.tone}
              size={18}
            />
          }
        >
          <div className="space-y-2">
            {groups.map((item) => {
              const key = `grp-${item.id}`;
              return (
                <InsetPanel
                  key={item.id}
                  tone="white"
                  padding="compact"
                  className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="text-sm font-medium text-gray-900">
                    {item.groupName}
                  </span>
                  <div className="flex items-center gap-2">
                    <CustomSelect
                      ariaLabel={`Ersatz für ${item.groupName}`}
                      value={groupReplacements[item.id] ?? ""}
                      onChange={(next) =>
                        setGroupReplacements((prev) => ({
                          ...prev,
                          [item.id]: next,
                        }))
                      }
                      options={[
                        { value: "", label: "Ohne Ersatz entfernen" },
                        ...availableStaff.map((staff) => ({
                          value: staff.id,
                          label: staff.fullName,
                        })),
                      ]}
                      disabled={loadingStaff || processing[key]}
                    />
                    <OverflowMenu
                      ariaLabel={`Aktionen für ${item.groupName}`}
                      items={buildResolutionMenu(
                        Boolean(groupReplacements[item.id]),
                        processing[key] === true ||
                          !(item.groupId in storedGroups),
                        () => resolveGroup(item),
                      )}
                    />
                  </div>
                </InsetPanel>
              );
            })}
          </div>
        </InfoSection>
      ) : null}

      <LoadErrorAlert error={staffLoadError} />
      <LoadErrorAlert error={groupLoadError} />
      <FormErrorAlert message={actionErrors.error} />

      <ConfirmationModal
        isOpen={
          pendingRemoval?.kind === "supervision" ||
          pendingRemoval?.kind === "substitution"
        }
        title={
          pendingRemoval?.kind === "supervision"
            ? "Gruppenaufsicht beenden?"
            : "Gruppenübergabe beenden?"
        }
        confirmText={
          pendingRemoval?.kind === "supervision"
            ? "Aufsicht beenden"
            : "Übergabe beenden"
        }
        cancelText="Abbrechen"
        isConfirmLoading={pendingProcessing}
        loadingText={
          pendingRemoval?.kind === "supervision"
            ? "Aufsicht wird beendet …"
            : "Übergabe wird beendet …"
        }
        isDismissDisabled={pendingProcessing}
        onConfirm={() => void confirmPendingRemoval()}
        onClose={closeConfirmation}
      >
        <p className="text-sm text-gray-700">
          {pendingRemoval?.kind === "supervision"
            ? "Die Gruppenaufsicht für "
            : "Die Übergabe der Gruppe "}
          <strong>
            {pendingRemoval?.kind === "supervision" ||
            pendingRemoval?.kind === "substitution"
              ? pendingRemoval.item.groupName
              : ""}
          </strong>{" "}
          wird beendet.
          {pendingRemoval?.kind === "substitution"
            ? " Die Gruppe liegt danach wieder bei ihrer regulären Leitung."
            : ""}
        </p>
      </ConfirmationModal>
      <ConfirmDeleteModal
        isOpen={
          pendingRemoval?.kind === "activity" ||
          pendingRemoval?.kind === "group"
        }
        title={
          pendingRemoval?.kind === "group"
            ? "Gruppenleitung entfernen?"
            : "Aktivitätsleitung entfernen?"
        }
        description={
          pendingRemoval?.kind === "activity" ? (
            <p>
              Die Leitung der Aktivität{" "}
              <span className="font-medium text-gray-900">
                {pendingRemoval.item.activityName}
              </span>{" "}
              wird ohne Ersatz entfernt. Wähle eine Ersatzkraft, um sie
              stattdessen zu übertragen.
            </p>
          ) : pendingRemoval?.kind === "group" ? (
            <p>
              Die Leitung der Gruppe{" "}
              <span className="font-medium text-gray-900">
                {pendingRemoval.item.groupName}
              </span>{" "}
              wird ohne Ersatz entfernt. Wähle eine Ersatzkraft, um sie
              stattdessen zu übertragen.
            </p>
          ) : null
        }
        gate={{ mode: "twoStep", firstStepLabel: "Ja, entfernen" }}
        confirmLabel="Ohne Ersatz entfernen"
        loadingLabel="Wird entfernt…"
        loading={pendingProcessing}
        error=""
        onConfirm={() => void confirmPendingRemoval()}
        onClose={closeConfirmation}
      />
    </div>
  );
}
