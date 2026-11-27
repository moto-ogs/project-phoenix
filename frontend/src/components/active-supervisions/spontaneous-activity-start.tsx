"use client";

import type * as roomsContract from "~/lib/contract/rooms.generated";
import { Plus, Search } from "lucide-react";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { InsetPanel } from "~/components/ui/inset-panel";
import type { FormEvent } from "react";
import { useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { CustomSelect } from "~/components/ui/custom-select";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { FormModal } from "~/components/ui/form-modal";
import { SuggestInput } from "~/components/ui/suggest-input";
import { useApiFormError } from "~/contexts/ToastContext";
import { activityService } from "~/lib/activity-service";
import type { Activity } from "~/lib/activity-helpers";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { fetchPlannerRooms } from "~/lib/planner-reference-api";
import { useClosedRoomsOnState } from "~/lib/hooks/use-closed-rooms";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { roomClosureHint } from "~/lib/room-closures-api";
import type { Staff } from "~/lib/staff-api";
import { useSWRAuth } from "~/lib/swr";
import { staff as staffResource } from "~/lib/swr/staff";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";
import { externalAccountMark } from "~/lib/staff-helpers";
import { ExternalBadge } from "~/components/staff/external-badge";
import { StatusBadge } from "~/components/ui/status-badge";

import { ExternalCaregiverEntry } from "~/components/staff/external-caregiver-entry";
import { staffConcept } from "~/lib/concepts/staff";
import { IconTile } from "~/components/ui/icon-tile";
import { ChoiceTile } from "~/components/ui/choice-tile";
import { SectionCard } from "~/components/ui/section-card";

const EMPTY_OCCUPIED_ROOM_IDS: readonly string[] = [];

interface RoomOption {
  id: string;
  name: string;
  building?: string | null;
}

export interface SpontaneousActivityStartPayload {
  title: string;
  roomId: string;
  activityGroupId?: string;
  additionalStaffIds: string[];
}

interface SpontaneousActivityStartProps {
  readonly canCreateExternalCaregiver?: boolean;
  /** Offer „Nur ansehen“ in the external entry (users:manage, ADR 0091). */
  readonly canGrantExternalView?: boolean;
  readonly currentStaffId?: string;
  readonly defaultRoomId?: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly isStarting?: boolean;
  readonly occupiedRoomIds?: readonly string[];
  readonly onStart: (payload: SpontaneousActivityStartPayload) => void;
  /**
   * Eigener Auslöser statt der Karte (App, #8070): ein Knopf am Listenende
   * oder in der Aktionsleiste. Der Dialog bleibt derselbe.
   */
  readonly renderTrigger?: (trigger: {
    open: () => void;
    disabled: boolean;
  }) => ReactNode;
  /**
   * Von außen geöffnet (App, #8070): der Auslöser steht im „…“-Menü der
   * Seite. Ohne die beiden Props hält die Komponente den Zustand selbst.
   */
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

function normalizeRooms(rooms: roomsContract.RoomResponse[]): RoomOption[] {
  return rooms
    .map((room) => ({
      id: room.id,
      name: room.name,
      building: room.building ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
}

/**
 * The room to preselect: the previous choice while free, else the configured
 * default room while free, else the first free room.
 */
function preselectRoom(
  rooms: readonly RoomOption[],
  previous: string,
  defaultRoomId: string | undefined,
  occupied: ReadonlySet<string>,
): string {
  const previousRoom = rooms.find((room) => room.id === previous);
  if (previousRoom && !isRoomOccupied(previousRoom, occupied)) return previous;
  const configuredDefaultRoom = rooms.find((room) => room.id === defaultRoomId);
  if (configuredDefaultRoom && !isRoomOccupied(configuredDefaultRoom, occupied))
    return configuredDefaultRoom.id;
  return rooms.find((room) => !isRoomOccupied(room, occupied))?.id ?? "";
}

function staffLabel(staff: Staff): string {
  return (
    staff.name || [staff.firstName, staff.lastName].filter(Boolean).join(" ")
  );
}

function findSelectedActivity(
  activities: Activity[],
  activityInput: string,
): Activity | undefined {
  const normalized = activityInput.trim().toLocaleLowerCase("de");
  if (!normalized) return undefined;
  return activities.find(
    (activity) => activity.name.trim().toLocaleLowerCase("de") === normalized,
  );
}

function isRoomOccupied(
  room: RoomOption,
  occupiedRoomIds: ReadonlySet<string>,
): boolean {
  return occupiedRoomIds.has(room.id);
}

export function SpontaneousActivityStart({
  canCreateExternalCaregiver = false,
  canGrantExternalView = false,
  currentStaffId,
  defaultRoomId,
  disabled = false,
  disabledReason,
  isStarting = false,
  occupiedRoomIds = EMPTY_OCCUPIED_ROOM_IDS,
  onStart,
  renderTrigger,
  open: openProp,
  onOpenChange,
}: SpontaneousActivityStartProps) {
  const [isOpenState, setIsOpenState] = useState(false);
  const isOpen = openProp ?? isOpenState;
  const setIsOpen = onOpenChange ?? setIsOpenState;
  const [activityInput, setActivityInput] = useState("");
  const [roomId, setRoomId] = useState("");
  const [additionalStaffIds, setAdditionalStaffIds] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useApiFormError(formRef);
  const { clear: clearFormErrors } = formErrors;
  // Ein heute gesperrter Raum (#7653) ist nicht wählbar; die Auswahl nennt
  // den Grund. Er bleibt von belegten Räumen getrennt, damit eine veraltete
  // Auswahl die passende Sperrmeldung erhält.
  const today = useBerlinToday();
  const closures = useClosedRoomsOnState(isOpen ? today : null);
  const { closedRooms, isLoading: isLoadingClosures } = closures;
  const occupiedRoomIdSet = useMemo(
    () => new Set(occupiedRoomIds),
    [occupiedRoomIds],
  );
  const unavailableRoomIdSet = useMemo(
    () => new Set([...occupiedRoomIdSet, ...closedRooms.keys()]),
    [occupiedRoomIdSet, closedRooms],
  );

  // Auswahllisten (Aktivitäten, Räume, Personal): jede Liste füllt, was sie
  // bekommt; der erste Fehlschlag steht im Dialog, „Wiederholen“ lädt alle
  // drei neu.
  const activityList = useSWRAuth(
    isOpen ? tenantDailyKeys.activities() : null,
    () => activityService.getActivities(),
  );
  // The staff room list includes Schulhof as a regular destination (#2161)
  // while keeping WC infrastructure hidden.
  const roomList = useSWRAuth(
    isOpen ? tenantDailyKeys.plannerRooms() : null,
    () => fetchPlannerRooms(),
  );
  const staffList = useSWRAuth(isOpen ? staffResource.key() : null, () =>
    staffResource.fetcher(),
  );
  const resources = [activityList, roomList, staffList, closures];
  const isLoadingRefs =
    isOpen &&
    (isLoadingClosures ||
      resources.some(
        (resource) => resource.data === undefined && !resource.error,
      ));
  const { error: loadError } = useSwrResourceLoadError(
    resources,
    "die Auswahl für die spontane Aktivität",
    () => {
      for (const resource of resources) void resource.mutate();
    },
  );
  // Without the staff list the section has nobody to offer, so it stays
  // hidden after a failed load; the load error in the dialog says why.
  const staffData = isOpen ? staffList.data : undefined;
  const staffLoaded = staffData !== undefined;

  const activities = useMemo(
    () =>
      [...((isOpen ? activityList.data : undefined) ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name, "de"),
      ),
    [activityList.data, isOpen],
  );
  const rooms = useMemo(
    () => normalizeRooms((isOpen ? roomList.data : undefined) ?? []),
    [roomList.data, isOpen],
  );
  const staff = useMemo(
    () =>
      (staffData ?? [])
        .filter((item) => item.id !== currentStaffId)
        .sort((a, b) => staffLabel(a).localeCompare(staffLabel(b), "de")),
    [staffData, currentStaffId],
  );

  // A room is preselected once per loaded list, with the occupancy of that
  // moment. The dashboard poll hands over a new occupancy every few seconds;
  // it must not move the choice. The room list itself marks occupied rooms
  // from the live value.
  const [preselectedFor, setPreselectedFor] = useState<
    readonly RoomOption[] | null
  >(null);
  if (isOpen && roomList.data && !isLoadingRefs && preselectedFor !== rooms) {
    setPreselectedFor(rooms);
    setRoomId((prev) =>
      preselectRoom(rooms, prev, defaultRoomId, unavailableRoomIdSet),
    );
  }

  const selectedActivity = useMemo(
    () => findSelectedActivity(activities, activityInput),
    [activities, activityInput],
  );
  const title = selectedActivity?.name ?? activityInput.trim();
  const selectedRoom = rooms.find((room) => room.id === roomId);
  const isSelectedRoomOccupied =
    selectedRoom !== undefined &&
    isRoomOccupied(selectedRoom, occupiedRoomIdSet);
  const isSelectedRoomClosed =
    selectedRoom !== undefined && closedRooms.has(selectedRoom.id);
  const canSubmit =
    title.length > 0 &&
    roomId.length > 0 &&
    !isSelectedRoomClosed &&
    !isSelectedRoomOccupied &&
    !isStarting;
  const suggestedActivities = activities.slice(0, 5);
  const activityNames = useMemo(
    () => activities.map((activity) => activity.name),
    [activities],
  );
  const roomOptions = useMemo(
    () =>
      rooms.map((room) => {
        const closure = closedRooms.get(room.id);
        const state = closure
          ? ` (${roomClosureHint(closure)})`
          : isRoomOccupied(room, occupiedRoomIdSet)
            ? " (belegt)"
            : "";
        return {
          value: room.id,
          label: `${room.building ? `${room.building} - ` : ""}${room.name}${state}`,
          disabled:
            closure !== undefined || isRoomOccupied(room, occupiedRoomIdSet),
        };
      }),
    [rooms, occupiedRoomIdSet, closedRooms],
  );

  function toggleStaff(staffId: string) {
    setAdditionalStaffIds((prev) =>
      prev.includes(staffId)
        ? prev.filter((id) => id !== staffId)
        : [...prev, staffId],
    );
  }

  function addExternalCaregiver(saved: Staff) {
    // The new record carries its open invitation and is offered like
    // everyone else.
    void staffList.mutate(
      (prev) => [...(prev ?? []).filter((item) => item.id !== saved.id), saved],
      { revalidate: false },
    );
    setAdditionalStaffIds((prev) =>
      prev.includes(saved.id) ? prev : [...prev, saved.id],
    );
  }

  function resetAndClose() {
    setIsOpen(false);
    setActivityInput("");
    setRoomId("");
    setAdditionalStaffIds([]);
    setPreselectedFor(null);
    clearFormErrors();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSelectedRoomClosed) {
      formErrors.invalid("Dieser Raum ist heute gesperrt.");
      return;
    }
    if (isSelectedRoomOccupied) {
      formErrors.invalid(
        "Der Raum ist schon belegt. Bitte wähle einen anderen Raum.",
      );
      return;
    }
    if (!canSubmit) {
      formErrors.invalid(
        "Bitte wähle eine Aktivität und einen Raum.",
        title.length > 0
          ? {}
          : { activity: "Bitte wähle oder schreibe eine Aktivität." },
      );
      return;
    }
    onStart({
      title,
      roomId,
      activityGroupId: selectedActivity?.id,
      additionalStaffIds,
    });
    resetAndClose();
  }

  return (
    <>
      {renderTrigger ? (
        renderTrigger({
          open: () => setIsOpen(true),
          disabled: disabled || isStarting,
        })
      ) : (
        <SectionCard className="mb-4">
          <Button
            type="button"
            disabled={disabled || isStarting}
            onClick={() => setIsOpen(true)}
            variant="surface_success"
            size="card"
            className="w-full justify-start gap-3 text-left"
            tooltip="Öffnet die Auswahl für eine spontane Aktivität."
          >
            <IconTile
              shape="round"
              tone="greenFill"
              icon={<Plus aria-hidden="true" />}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-gray-900">
                Spontane Aktivität starten
              </span>
              <span className="block text-sm text-gray-600">
                {disabledReason ??
                  "Aktivität wählen, Raum belegen, Kinder danach hinzufügen"}
              </span>
            </span>
          </Button>
        </SectionCard>
      )}

      {/* oxlint-disable-next-line ui-kit/form-modal-pending -- übergibt die Auswahl synchron an onStart und schließt; gespeichert wird danach außerhalb des Dialogs. */}
      <FormModal
        isOpen={isOpen}
        onClose={resetAndClose}
        title="Spontane Aktivität"
        size="md"
        error={formErrors.error}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={resetAndClose}
              noTooltip="Schließt nur das Fenster."
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              form="spontaneous-activity-form"
              variant="primary"
              size="md"
              isLoading={isStarting}
              loadingText="Startet ..."
              disabled={!canSubmit || isLoadingRefs}
              disabledReason={
                isLoadingRefs
                  ? undefined
                  : startBlockedReason({
                      title,
                      roomId,
                      isSelectedRoomClosed,
                      isSelectedRoomOccupied,
                    })
              }
              tooltip="Startet die Aktivität sofort im gewählten Raum."
            >
              Aktivität starten
            </Button>
          </>
        }
      >
        <form
          ref={formRef}
          id="spontaneous-activity-form"
          className="space-y-4"
          onSubmit={handleSubmit}
        >
          <LoadErrorAlert error={loadError} />

          <SuggestInput
            name="activity"
            label="Aktivität"
            listLabel="Vorschläge für die Aktivität"
            error={formErrors.fieldError("activity")}
            controlSize="compact"
            leadingIcon={<Search />}
            value={activityInput}
            onValueChange={setActivityInput}
            suggestions={activityNames}
            maxSuggestions={8}
            highlightFirst
            placeholder="Aktivität suchen oder neu eingeben"
            required
          />

          {suggestedActivities.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {suggestedActivities.map((activity) => (
                <Button
                  key={activity.id}
                  type="button"
                  variant="surface"
                  size="compact"
                  onClick={() => setActivityInput(activity.name)}
                  tooltip="Trägt diese Aktivität in das Feld oben ein."
                >
                  {activity.name}
                </Button>
              ))}
            </div>
          ) : null}

          <CustomSelect
            label="Raum"
            value={roomId}
            options={roomOptions}
            onChange={setRoomId}
            disabled={isLoadingRefs}
            required
            error={
              selectedRoom && closedRooms.has(selectedRoom.id)
                ? "Dieser Raum ist heute gesperrt."
                : isSelectedRoomOccupied
                  ? "Dieser Raum ist bereits belegt."
                  : null
            }
            errorLive
            placeholder={isLoadingRefs ? "Lade Räume ..." : "Raum auswählen"}
          />

          {isLoadingRefs || !staffLoaded ? null : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <MotoConceptIcon concept={staffConcept} size={16} />
                Weitere Betreuer
              </div>
              {staff.length > 0 ? (
                <InsetPanel
                  framed
                  className="grid max-h-44 gap-2 overflow-y-auto"
                >
                  {staff.map((item) => {
                    const accountMark = item.isExternal
                      ? externalAccountMark(item.externalAccountStatus)
                      : null;
                    return (
                      <ChoiceTile
                        key={item.id}
                        selected={additionalStaffIds.includes(item.id)}
                        className="min-h-10 py-2 font-normal"
                      >
                        <Checkbox
                          checked={additionalStaffIds.includes(item.id)}
                          onChange={() => toggleStaff(item.id)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block break-words">
                            {staffLabel(item)}
                          </span>
                          {item.isExternal ? (
                            <span className="mt-1 flex flex-wrap gap-1">
                              <span className="max-w-full min-w-0 [overflow-wrap:anywhere] [&>span]:whitespace-normal">
                                <ExternalBadge
                                  organization={item.externalOrganization}
                                />
                              </span>
                              {accountMark ? (
                                <StatusBadge {...accountMark} compact />
                              ) : null}
                            </span>
                          ) : null}
                        </span>
                      </ChoiceTile>
                    );
                  })}
                </InsetPanel>
              ) : null}
              {canCreateExternalCaregiver ? (
                <ExternalCaregiverEntry
                  onAdded={addExternalCaregiver}
                  canGrantView={canGrantExternalView}
                />
              ) : null}
            </div>
          )}
        </form>
      </FormModal>
    </>
  );
}

/** Why „Aktivität starten“ is locked, in the order the form asks. */
function startBlockedReason(input: {
  title: string;
  roomId: string;
  isSelectedRoomClosed: boolean;
  isSelectedRoomOccupied: boolean;
}): string | undefined {
  if (input.title.length === 0)
    return "Wähle oder schreibe zuerst eine Aktivität.";
  if (input.roomId.length === 0) return "Wähle zuerst einen Raum aus.";
  if (input.isSelectedRoomClosed) return "Dieser Raum ist heute gesperrt.";
  if (input.isSelectedRoomOccupied)
    return "Wähle einen freien Raum, dieser ist belegt.";
  return undefined;
}
