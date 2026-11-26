"use client";

/**
 * Dialog „Raum sperren“ (#7653): Zeitraum und Grund. Er zeigt die Termine,
 * die in der Zeit schon im Raum liegen. Sie bleiben dort; die Leitung verlegt
 * sie selbst über den Raumplan.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { FormModal } from "~/components/ui/form-modal";
import { FramedList } from "~/components/ui/framed-list";
import { Input } from "~/components/ui/input";
import { ListRow } from "~/components/ui/list-row";
import { SectionLabel } from "~/components/ui/section-label";
import { SkeletonRows } from "~/components/ui/skeleton";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { useApiFormError } from "~/contexts/ToastContext";
import { formatDate } from "~/lib/date-helpers";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import {
  addCalendarDays,
  closeRoom,
  ROOM_CLOSURE_MAX_DAYS,
  ROOM_CLOSURE_REASON_MAX_LENGTH,
} from "~/lib/room-closures-api";
import { fetchRoomPlanBlocks } from "~/lib/room-plan-api";
import { useSWRAuth } from "~/lib/swr";
import { roomKeys } from "~/lib/swr/rooms-keys";

const logger = createLogger({ component: "RoomClosureModal" });

/** Der Raumplan lädt höchstens acht Wochen am Stück. */
const AFFECTED_WINDOW_DAYS = 56;

interface RoomClosureModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSaved: () => void;
  readonly roomId: string;
  readonly today: string;
  /** Ob das Konto den Raumplan lesen darf; sonst fehlt die Terminliste. */
  readonly canReadPlan: boolean;
  /** Link zum Tag im Raumplan. */
  readonly planHref: (day: string) => string;
}

export function RoomClosureModal({
  isOpen,
  onClose,
  onSaved,
  roomId,
  today,
  canReadPlan,
  planHref,
}: RoomClosureModalProps) {
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState("");
  const latestStartDate = addCalendarDays(today, ROOM_CLOSURE_MAX_DAYS - 1);
  const save = useFormModalPending(isOpen);
  const formRef = useRef<HTMLDivElement>(null);
  const formErrors = useApiFormError(formRef);
  const clearErrors = formErrors.clear;
  const latestSaveRef = useRef<() => void>(() => undefined);

  const opened = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      opened.current = false;
      return;
    }
    if (opened.current) return;
    opened.current = true;
    setStartDate(today);
    setEndDate(today);
    setReason("");
    clearErrors();
  }, [isOpen, today, clearErrors]);

  const periodValid = Boolean(startDate && endDate && endDate >= startDate);
  const affectedUntil = periodValid
    ? minDay(endDate, addCalendarDays(startDate, AFFECTED_WINDOW_DAYS - 1))
    : "";
  const affected = useSWRAuth(
    isOpen && canReadPlan && periodValid
      ? roomKeys.plan(roomId, startDate, affectedUntil)
      : null,
    () => fetchRoomPlanBlocks(roomId, startDate, affectedUntil),
  );
  const affectedError = useSwrLoadError(
    affected.error,
    "die Termine im Zeitraum",
    () => void affected.mutate(),
  );
  const appointments = (affected.data ?? []).filter(
    (block) => block.status !== "cancelled",
  );

  const handleSave = async () => {
    const fields = closureFieldErrors(reason, startDate, endDate, today);
    if (Object.keys(fields).length > 0) {
      formErrors.invalid("Bitte prüfe die markierten Felder.", fields);
      return;
    }
    await save.run(async (op) => {
      formErrors.clear();
      try {
        await closeRoom(roomId, {
          startDate,
          endDate,
          reason: reason.trim(),
        });
      } catch (error) {
        logger.error("room_closure_save_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        if (!op.isCurrent()) return;
        await formErrors.show(error, {
          object: "das Sperren des Raums",
          retry: () => latestSaveRef.current(),
        });
        return;
      }
      onSaved();
      if (!op.isCurrent()) return;
      onClose();
    });
  };
  useLayoutEffect(() => {
    latestSaveRef.current = () => void handleSave();
  });

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      title="Raum sperren"
      size="md"
      pending={save}
      error={formErrors.error}
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onClose}
            noTooltip="Schließt nur das Fenster, ohne etwas zu speichern."
          >
            Abbrechen
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => void handleSave()}
            disabled={save.pending}
            tooltip="Sperrt den Raum für neue Termine und am Kiosk."
          >
            {save.pending ? "Speichern..." : "Sperren"}
          </Button>
        </div>
      }
    >
      <div ref={formRef} className="space-y-4">
        <Input
          id="room-closure-reason"
          name="reason"
          type="text"
          label="Grund"
          required
          value={reason}
          maxLength={ROOM_CLOSURE_REASON_MAX_LENGTH}
          onChange={(event) => setReason(event.target.value)}
          error={formErrors.fieldError("reason")}
          placeholder="z. B. Wasserschaden, Reinigung"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            id="room-closure-start"
            name="start_date"
            type="date"
            label="Von"
            controlSize="large"
            value={startDate}
            min={today}
            max={latestStartDate}
            onChange={(event) => {
              const value = event.target.value;
              setStartDate(value);
              if (!endDate || endDate < value) setEndDate(value);
            }}
            error={formErrors.fieldError("start_date")}
          />
          <Input
            id="room-closure-end"
            name="end_date"
            type="date"
            label="Bis"
            controlSize="large"
            value={endDate}
            min={startDate || today}
            onChange={(event) => setEndDate(event.target.value)}
            error={formErrors.fieldError("end_date")}
          />
        </div>
        <p className="text-xs text-gray-500">
          Für einen Tag wählst du in beiden Feldern dasselbe Datum. In der Zeit
          kannst du den Raum für neue Termine nicht wählen, und am Kiosk fehlt
          er.
        </p>

        {canReadPlan && periodValid ? (
          <div className="space-y-2">
            <SectionLabel as="h3">
              {affected.data
                ? `Termine in dieser Zeit (${appointments.length})`
                : "Termine in dieser Zeit"}
            </SectionLabel>
            {affectedError ? (
              <LoadErrorAlert error={affectedError} actionLayout="responsive" />
            ) : !affected.data ? (
              <SkeletonRows rows={2} />
            ) : appointments.length === 0 ? (
              <p className="text-sm text-gray-600">
                In dieser Zeit liegt kein Termin im Raum.
              </p>
            ) : (
              <>
                <Alert
                  type="warning"
                  size="compact"
                  message="Diese Termine bleiben im Raum. Verlege sie im Raumplan in einen anderen Raum."
                />
                <FramedList maxHeight="sm">
                  {appointments.map((block) => (
                    <ListRow
                      key={block.id}
                      href={planHref(block.date)}
                      density="compact"
                    >
                      <span className="text-sm text-gray-900">
                        {formatDate(block.date)}, {block.startTime}–
                        {block.endTime} · {block.title}
                      </span>
                    </ListRow>
                  ))}
                </FramedList>
                {affectedUntil < endDate ? (
                  <p className="text-xs text-gray-500">
                    Die Liste zeigt die ersten acht Wochen.
                  </p>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    </FormModal>
  );
}

function minDay(a: string, b: string): string {
  return a < b ? a : b;
}

/** Prüfung vor dem Senden. Schlüssel sind die Feldnamen des Backends. */
function closureFieldErrors(
  reason: string,
  startDate: string,
  endDate: string,
  today: string,
): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!reason.trim()) fields.reason = "Bitte gib einen Grund an.";
  if (!startDate) fields.start_date = "Bitte wähle den ersten Tag.";
  if (!endDate) fields.end_date = "Bitte wähle den letzten Tag.";
  if (
    startDate &&
    addCalendarDays(today, ROOM_CLOSURE_MAX_DAYS - 1) < startDate
  )
    fields.start_date =
      "Du kannst den Raum höchstens ein Jahr im Voraus sperren.";
  if (startDate && endDate && endDate < startDate)
    fields.end_date = "Der letzte Tag darf nicht vor dem ersten liegen.";
  else if (endDate && endDate < today)
    fields.end_date = "Der letzte Tag darf nicht vor heute liegen.";
  else if (
    startDate &&
    endDate &&
    addCalendarDays(startDate, ROOM_CLOSURE_MAX_DAYS) <= endDate
  )
    fields.end_date = "Eine Sperre dauert höchstens ein Jahr.";
  return fields;
}
