"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import { ISODatePicker } from "~/components/ui/date-picker";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { Input } from "~/components/ui/input";
import { Modal } from "~/components/ui/modal";
import { TimeField } from "~/components/ui/time-field";
import { Textarea } from "~/components/ui/textarea";
import { formatDate, parseISODate, toISODate } from "~/lib/date-helpers";
import { useLocalizedDatePicker } from "~/lib/hooks/use-localized-date-picker";
import { createLogger } from "~/lib/logger";
import { useApiFormError } from "~/contexts/ToastContext";
import { isChangedSinceRead } from "~/lib/api-error";
import { useCareTermTranslations } from "~/lib/care-facility-term";
import { useInvalidateFamily, useSWRAuth } from "~/lib/swr";
import { parentKeys } from "~/lib/swr/parent-keys";
import {
  listParentRequestEvents,
  updateExcusedRequest,
  updateMasterDataRequest,
  updatePickupChangeRequest,
  type ParentRequestShareType,
} from "~/lib/parent-api";

const logger = createLogger({ component: "RequestEditModal" });

/**
 * Eine noch offene Anfrage, so wie die Eltern sie ändern können. Ein Typ pro
 * Anfrageart, damit ein Dialog reicht statt vier fast gleicher Dialoge.
 * `version` stammt aus derselben Listenzeile wie die Werte; das Speichern
 * schickt sie als `expected_version` zurück (ADR 0311).
 */
export type EditableRequest =
  | {
      readonly type: "excused";
      readonly id: string;
      readonly version: string;
      readonly dates: string[];
      readonly note: string;
    }
  | {
      readonly type: "pickup_change";
      readonly id: string;
      readonly version: string;
      readonly date: string;
      readonly pickupTime: string;
      readonly reason: string;
    }
  | {
      readonly type: "master_data";
      readonly id: string;
      readonly version: string;
      readonly label: string;
      readonly value: string;
    };

/**
 * Wann die Eltern die Anfrage zuletzt geändert haben, aus ihrer
 * Änderungsgeschichte. Nur eine Anzeige: fehlt sie, bleibt das Bearbeiten
 * möglich.
 */
export function useRequestEditedAt(
  studentId: string,
  requestType: ParentRequestShareType,
  requestId: string,
  active: boolean,
): string | null {
  const { data: events } = useSWRAuth(
    active ? parentKeys.requestEvents(studentId, requestType, requestId) : null,
    () => listParentRequestEvents(studentId, requestType, requestId),
  );
  return useMemo(
    () =>
      events?.filter((event) => event.event_type === "guardian_edited").at(-1)
        ?.created_at ?? null,
    [events],
  );
}

async function saveRequest(
  studentId: string,
  request: EditableRequest,
  draft: Draft,
  version: string,
): Promise<void> {
  switch (request.type) {
    case "excused":
      await updateExcusedRequest(studentId, request.id, {
        dates: enumerateDates(draft.from, draft.to),
        note: draft.text.trim(),
        expectedVersion: version,
      });
      return;
    case "pickup_change":
      await updatePickupChangeRequest(studentId, request.id, {
        date: draft.from,
        pickupTime: draft.time,
        reason: draft.text.trim(),
        expectedVersion: version,
      });
      return;
    case "master_data":
      await updateMasterDataRequest(studentId, request.id, {
        newValue: draft.text.trim(),
        expectedVersion: version,
      });
  }
}

interface Draft {
  from: string;
  to: string;
  time: string;
  text: string;
}

function initialDraft(request: EditableRequest): Draft {
  if (request.type === "excused") {
    const sorted = [...request.dates].sort((a, b) => a.localeCompare(b));
    return {
      from: sorted[0] ?? "",
      to: sorted.at(-1) ?? "",
      time: "",
      text: request.note,
    };
  }
  if (request.type === "pickup_change") {
    return {
      from: request.date,
      to: request.date,
      time: request.pickupTime,
      text: request.reason,
    };
  }
  return { from: "", to: "", time: "", text: request.value };
}

function enumerateDates(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  const cursor = parseISODate(fromISO);
  const end = parseISODate(toISO);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return [];
  while (cursor.getTime() <= end.getTime() && out.length < 60) {
    out.push(toISODate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/**
 * „Anfrage bearbeiten": ändert eine noch offene Anfrage, statt sie
 * zurückzuziehen. Die OGS sieht danach die neue Fassung.
 */
export function RequestEditModal({
  studentId,
  request,
  reasonRequired = true,
  onClose,
  onReload,
}: Readonly<{
  studentId: string;
  /** Die Anfrage aus der aktuellen Liste, mit ihrer `version`. */
  request: EditableRequest;
  reasonRequired?: boolean;
  onClose: () => void;
  /** Lädt die Liste neu: nach dem Speichern und wenn die Anfrage inzwischen
   * anders gespeichert ist. */
  onReload: () => void;
}>) {
  const t = useCareTermTranslations("parentRequestEdit");
  const tError = useTranslations("errorCatalog");
  const tTimePicker = useTranslations("datePicker.timePicker");
  const locale = useLocale();
  const datePicker = useLocalizedDatePicker();
  const [draft, setDraft] = useState<Draft>(() => initialDraft(request));
  // The version the draft was filled from; saving sends it (ADR 0311). A
  // newer read refills the draft only while it is untouched, so typed input
  // is never replaced silently. After a refusal, `reloading` waits for the
  // stored request and then shows its values with the refusal message.
  const [draftVersion, setDraftVersion] = useState(request.version);
  const [touched, setTouched] = useState(false);
  const [reloading, setReloading] = useState(false);
  if (draftVersion !== request.version && (!touched || reloading)) {
    setDraftVersion(request.version);
    setDraft(initialDraft(request));
    setTouched(false);
    setReloading(false);
  }
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const { error, show, invalid, fieldError, clear } = useApiFormError(formRef);
  const editedAt = useRequestEditedAt(
    studentId,
    request.type,
    request.id,
    true,
  );
  const invalidateFamily = useInvalidateFamily();

  const set = (patch: Partial<Draft>) => {
    setTouched(true);
    setDraft((current) => ({ ...current, ...patch }));
  };

  const submit = async () => {
    const fieldHint = tError("actions.fieldCheck");
    if (request.type === "master_data" && draft.text.trim() === "") {
      invalid(t("valueRequired"), { "request-value": fieldHint });
      return;
    }
    if (
      request.type !== "master_data" &&
      reasonRequired &&
      draft.text.trim() === ""
    ) {
      invalid(t("reasonRequired"), { "request-reason": fieldHint });
      return;
    }
    setSaving(true);
    clear();
    try {
      await saveRequest(studentId, request, draft, draftVersion);
      void invalidateFamily(parentKeys.requestEventsFamily(studentId));
      onReload();
      onClose();
    } catch (err) {
      logger.warn("parent_request_edit_failed", {
        error: err instanceof Error ? err.message : String(err),
        request_type: request.type,
      });
      if (isChangedSinceRead(err)) {
        // The request was stored differently since the list was read:
        // sending the same version again would be refused again. The list
        // reloads, and the new version replaces the draft with its stored
        // values; until then the save stays locked.
        void show(err, { object: t("errorObject") });
        setReloading(true);
        onReload();
        return;
      }
      void show(err, {
        object: t("errorObject"),
        retry: () => void submitRef.current(),
      });
    } finally {
      setSaving(false);
    }
  };
  // The retry sends the latest draft, not the one of the failed attempt.
  const submitRef = useRef(submit);
  useLayoutEffect(() => {
    submitRef.current = submit;
  });

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t("title")}
      closeLabel={t("close")}
      closeTooltip={t("closeTooltip")}
      backdropLabel={t("close")}
      isDismissDisabled={saving}
      mobileSheet
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="md"
            className="hidden sm:inline-flex"
            disabled={saving}
            noTooltip="Abbrechen schließt das Fenster und ändert nichts."
            onClick={onClose}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            size="md"
            className="w-full sm:w-auto"
            isLoading={saving || reloading}
            loadingText={reloading ? t("reloading") : t("saving")}
            tooltip={t("submitTooltip")}
            onClick={() => void submit()}
          >
            {t("submit")}
          </Button>
        </>
      }
    >
      <div ref={formRef} className="space-y-4">
        <FormErrorAlert message={error} />
        <p className="text-sm leading-6 text-gray-700">{t("intro")}</p>
        {editedAt && (
          <p className="text-sm text-gray-600">
            {t("editedAt", { date: formatDate(editedAt, false, locale) })}
          </p>
        )}
        {request.type === "excused" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ISODatePicker
              {...datePicker}
              id="request-first-day"
              label={t("firstDay")}
              ariaLabel={t("firstDay")}
              value={draft.from}
              onChange={(next) =>
                set({ from: next, to: next > draft.to ? next : draft.to })
              }
              calendarLayout="popover"
              hideClearButton
            />
            <ISODatePicker
              {...datePicker}
              id="request-last-day"
              label={t("lastDay")}
              ariaLabel={t("lastDay")}
              value={draft.to}
              min={draft.from}
              onChange={(next) => set({ to: next })}
              calendarLayout="popover"
              hideClearButton
            />
          </div>
        )}
        {request.type === "pickup_change" && (
          <>
            <ISODatePicker
              {...datePicker}
              id="request-day"
              label={t("day")}
              ariaLabel={t("day")}
              value={draft.from}
              onChange={(next) => set({ from: next, to: next })}
              calendarLayout="popover"
              hideClearButton
            />
            <TimeField
              value={draft.time}
              onChange={(next) => set({ time: next })}
              label={t("pickupTime")}
              hint={t("timeFormatHint")}
              placeholder={t("timeExample")}
              timePickerLabels={{
                selectTime: tTimePicker("selectTime"),
                hour: tTimePicker("hour"),
                minute: tTimePicker("minute"),
                minimum: (time) => tTimePicker("minimum", { time }),
              }}
              required
            />
          </>
        )}
        {request.type === "master_data" ? (
          <Input
            name="request-value"
            label={request.label}
            autoComplete="off"
            value={draft.text}
            disabled={saving}
            error={fieldError("request-value")}
            onChange={(event) => set({ text: event.target.value })}
          />
        ) : (
          <Textarea
            name="request-reason"
            label={t("reasonLabel")}
            aria-required={reasonRequired}
            error={fieldError("request-reason")}
            value={draft.text}
            onChange={(event) => set({ text: event.target.value })}
            rows={3}
            maxLength={2000}
            className="min-h-20 text-base"
          />
        )}
      </div>
    </Modal>
  );
}
