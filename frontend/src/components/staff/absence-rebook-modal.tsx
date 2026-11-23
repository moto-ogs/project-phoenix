"use client";

// „Art ändern" (#3258): die Leitung bucht vorhandene Einträge auf eine andere
// Art um, zum Beispiel vergangene Freitage von Freizeitausgleich auf
// Krank-Urlaubstage. Die Einträge bleiben stehen. Vor dem Speichern zeigt der
// Dialog, was sich am Stundenkonto und an den Kontingenten ändert; was nicht
// reicht oder gesperrt ist, lässt sich nicht speichern. Das Speichern trägt
// den Fingerabdruck dieser Vorschau (ADR 0311).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  AccountsLoadError,
  bookingOptions,
  QuotaSummary,
  TypeChoice,
  useYearAccounts,
  yearsBetween,
  type Projection,
} from "~/components/staff/absence-booking-modal";
import type { SickReportStaff } from "~/components/staff/sick-report-modal";
import { formatSignedDuration } from "~/components/staff/staff-time-views";
import { Button } from "~/components/ui/button";
import { DataField, DataGrid } from "~/components/ui/data-field";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { Input } from "~/components/ui/input";
import { Modal } from "~/components/ui/modal";
import { StatusColorBadge } from "~/components/ui/status-color-badge";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import {
  ABSENCE_TYPE_HEX,
  absenceRowLabel,
  formatAbsenceRange,
  formatDayCount,
} from "~/lib/absence-helpers";
import { absenceRequestFor, selectValueFor } from "~/lib/absence-type-select";
import type { AbsenceType } from "~/lib/absence-type-api";
import { LOCATION_COLORS } from "~/lib/location-helper";
import type { RefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { createLogger } from "~/lib/logger";
import {
  staffAbsenceService,
  type AbsenceRebooking,
  type StaffAbsenceRow,
} from "~/lib/staff-api";
import { revalidateOrThrow, useSWRAuth } from "~/lib/swr";
import { useDraftOn } from "~/lib/swr/read-draft";
import { useReadDraftLoadError } from "~/lib/hooks/use-swr-load-error";
import { staffAbsenceKeys } from "~/lib/swr/staff-keys";
import { InsetPanel } from "~/components/ui/inset-panel";

const logger = createLogger({ component: "AbsenceRebookModal" });

/** Nur direkt eingetragene Einträge lassen sich umbuchen (#3258). */
export function isRebookableAbsence(row: StaffAbsenceRow): boolean {
  return row.status === "reported" && row.absence_type !== "sick";
}

function useRebookingPreview(args: {
  staffId: string;
  absenceIds: readonly string[];
  value: string;
}) {
  const { staffId, absenceIds, value } = args;
  // Eine gesperrte Umbuchung (workforce.rebooking_*) ist kein Defekt; sie
  // steht wie jeder andere Fehler der Vorschau im Dialog. Die Vorschau darf
  // aus dem Cache kommen: das Speichern schickt den Fingerabdruck der
  // gezeigten Wirkung mit, und der Server lehnt eine inzwischen andere ab
  // (ADR 0311).
  const key =
    value && absenceIds.length > 0
      ? staffAbsenceKeys.rebookingPreview(staffId, absenceIds, value)
      : null;
  const read = useSWRAuth(
    key,
    () => {
      const request = absenceRequestFor(value);
      return staffAbsenceService.rebookAbsences(staffId, {
        absenceIds: absenceIds.map(String),
        absenceType: request.absence_type,
        absenceTypeId: request.absence_type_id,
        reason: "",
        dryRun: true,
      });
    },
    { keepPreviousData: false },
  );
  // A failed read shows no older effect as the basis of a save.
  const failure = read.isValidating ? undefined : read.error;
  const draft = useDraftOn<AbsenceRebooking, AbsenceRebooking, string>(
    {
      opening: key,
      data: failure ? undefined : read.data,
      error: failure,
      reload: () => revalidateOrThrow(read),
    },
    {
      token: (effect) => effect.fingerprint,
      follow: false,
      // The dialog closes after a save: no read of the old effect.
      answer: (_saved, shown) => shown,
    },
  );
  const error = useReadDraftLoadError(draft, "die Änderung der Art");
  const failed = draft.status === "loadFailed";
  return {
    draft,
    preview: failed ? null : (draft.base ?? null),
    error: failed ? error : null,
    loading: Boolean(value) && draft.status === "loading",
  };
}

function BalanceLine({ minutes }: { readonly minutes: number }) {
  if (minutes === 0) {
    return (
      <p className="text-sm text-gray-600">Das Stundenkonto bleibt gleich.</p>
    );
  }
  return (
    <DataGrid columns={1}>
      <DataField inline label="Änderung am Stundenkonto">
        <span
          className={`font-semibold tabular-nums ${minutes < 0 ? "text-moto-red-strong" : ""}`}
        >
          {formatSignedDuration(minutes)}
        </span>
      </DataField>
    </DataGrid>
  );
}

export function AbsenceRebookModal({
  staff,
  types,
  absences,
  onClose,
  onSaved,
}: {
  readonly staff: SickReportStaff;
  readonly types: readonly AbsenceType[];
  readonly absences: readonly StaffAbsenceRow[];
  readonly onClose: () => void;
  /** Closes the dialog and reloads; never rejects (#6652). */
  readonly onSaved: RefreshAfterWrite;
}) {
  const toast = useToast();
  // Eine Art, die einer der gewählten Einträge schon hat, würde die gesamte
  // atomare Umbuchung sperren. Deshalb steht sie nicht zur Wahl.
  const currentValues = useMemo(
    () =>
      new Set(
        absences.map((row) =>
          selectValueFor(row.absence_type, row.absence_type_id),
        ),
      ),
    [absences],
  );
  const options = useMemo(
    () =>
      bookingOptions(types).filter(
        (option) => !currentValues.has(option.value),
      ),
    [types, currentValues],
  );
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const formErrors = useApiFormError();
  const clearFormErrors = formErrors.clear;
  // „Wiederholen“ sendet den aktuellen Grund, nicht den vom Fehlerzeitpunkt.
  const latestSaveRef = useRef<() => Promise<void>>(async () => undefined);

  const absenceIds = useMemo(() => absences.map((row) => row.id), [absences]);
  const firstDay = useMemo(
    () =>
      absences.reduce(
        (first, row) => (row.date_start < first ? row.date_start : first),
        absences[0]?.date_start ?? "",
      ),
    [absences],
  );
  const accountFirstDays = useMemo(() => {
    const firstDays = new Map<number, string>();
    for (const absence of absences) {
      for (const year of yearsBetween(absence.date_start, absence.date_end)) {
        const firstDayInYear =
          absence.date_start > `${year}-01-01`
            ? absence.date_start
            : `${year}-01-01`;
        const current = firstDays.get(year);
        if (!current || firstDayInYear < current) {
          firstDays.set(year, firstDayInYear);
        }
      }
    }
    return firstDays;
  }, [absences]);
  const years = useMemo(
    () => [...accountFirstDays.keys()].sort((left, right) => left - right),
    [accountFirstDays],
  );
  const {
    accounts,
    error: accountsError,
    reload: reloadAccounts,
  } = useYearAccounts(staff.id, types, years);
  const accountHints = useMemo(
    () =>
      years.map((year) => ({
        year,
        account: accounts.get(year),
        firstDay: accountFirstDays.get(year)!,
      })),
    [accountFirstDays, accounts, years],
  );
  const selected = options.find((option) => option.value === value);
  const {
    draft: effect,
    preview,
    error: previewError,
    loading,
  } = useRebookingPreview({
    staffId: staff.id,
    absenceIds,
    value,
  });

  // A new target discards the previous edit's validation or save error.
  useEffect(() => {
    clearFormErrors();
  }, [value, clearFormErrors]);

  const allowanceProjections: Projection[] = (preview?.allowances ?? [])
    .filter((item) => item.bookingDays > 0)
    .map((item) => ({
      year: item.year,
      remaining: item.remainingDays + item.bookingDays,
      needed: item.bookingDays,
    }));
  const vacationProjections: Projection[] = (preview?.vacation ?? [])
    .filter((item) => item.remainingBefore > item.remainingAfter)
    .map((item) => ({
      year: item.year,
      remaining: item.remainingBefore,
      needed: item.remainingBefore - item.remainingAfter,
    }));
  const freedVacation = (preview?.vacation ?? []).reduce(
    (sum, item) =>
      sum + Math.max(0, item.remainingAfter - item.remainingBefore),
    0,
  );
  const exceeded =
    (preview?.allowanceExceeded ?? false) ||
    (preview?.vacationExceeded ?? false);

  const disabled =
    saving ||
    !selected ||
    !preview ||
    !effect.canSubmit ||
    loading ||
    Boolean(previewError) ||
    exceeded;
  // Der Grund am gesperrten Knopf; beim Speichern bleibt er nativ gesperrt.
  const blockedReason = saving
    ? undefined
    : !selected
      ? "Wähle zuerst eine neue Art aus."
      : loading || (!effect.canSubmit && !previewError)
        ? "moto rechnet die Folgen der Änderung noch aus."
        : previewError
          ? "Lade zuerst die Vorschau oben neu."
          : exceeded
            ? "Ändere zuerst den Anspruch, die Tage reichen nicht."
            : undefined;
  // Warum „Art ändern“ gesperrt ist: steht im Fehlerfeld oben im Formular.
  const allowanceBlocker =
    [
      preview?.allowanceExceeded && selected
        ? `Nicht genug Tage: ${selected.label} reicht für diese Einträge nicht. Erhöhe zuerst den Anspruch oder wähle weniger Einträge.`
        : null,
      preview?.vacationExceeded
        ? "Nicht genug Urlaub: Der Resturlaub reicht für diese Einträge nicht. Erhöhe zuerst den Urlaubsanspruch."
        : null,
    ]
      .filter(Boolean)
      .join(" ") || null;

  const save = async () => {
    if (disabled || !selected || !preview) return;
    if (reason.trim() === "") {
      formErrors.invalid("Bitte prüfe die markierten Felder.", {
        reason: "Bitte kurz sagen, warum sich die Art ändert.",
      });
      return;
    }
    setSaving(true);
    formErrors.clear();
    const request = absenceRequestFor(value);
    // The fingerprint of the effect on screen (ADR 0311).
    const result = await effect.submit((expectedFingerprint) =>
      staffAbsenceService.rebookAbsences(staff.id, {
        absenceIds,
        absenceType: request.absence_type,
        absenceTypeId: request.absence_type_id,
        reason: reason.trim(),
        dryRun: false,
        expectedFingerprint,
      }),
    );
    setSaving(false);
    if (!result.ok) {
      logger.error("rebooking_failed", {
        staff_id: staff.id,
        absence_count: absences.length,
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      // Changed since the preview: `reload` shows the new effect, without a
      // retry of the refused fingerprint.
      await formErrors.show(result.error, {
        object: "die Änderung der Art",
        retry: () => void latestSaveRef.current(),
        reload: result.reload,
      });
      return;
    }
    toast.success(
      absences.length === 1
        ? `Der Eintrag ist jetzt ${selected.label}.`
        : `${absences.length} Einträge sind jetzt ${selected.label}.`,
    );
    await onSaved();
  };

  useLayoutEffect(() => {
    latestSaveRef.current = save;
  });

  return (
    <Modal
      isOpen
      onClose={() => !saving && onClose()}
      title={`Art ändern: ${staff.firstName} ${staff.lastName}`}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onClose}
            disabled={saving}
            noTooltip="Abbrechen schließt den Dialog, ohne etwas zu ändern."
          >
            Abbrechen
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => void save()}
            disabled={disabled}
            disabledReason={blockedReason}
            isLoading={saving}
            loadingText="Wird geändert…"
            tooltip="Bucht die gewählten Einträge sofort auf die neue Art um."
          >
            Art ändern
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* After a refusal the form's alert already names the failed read. */}
        {formErrors.error ? null : <LoadErrorAlert error={previewError} />}
        <FormErrorAlert message={allowanceBlocker ?? formErrors.error} />
        <p className="text-sm text-gray-600">
          Die Einträge bleiben stehen. Nur ihre Art ändert sich.
        </p>
        <section aria-label="Gewählte Einträge" className="space-y-2">
          <h4 className="text-sm font-medium text-gray-700">
            {absences.length === 1
              ? "1 Eintrag"
              : `${absences.length} Einträge`}
            {preview ? ` · ${formatDayCount(preview.days)}` : ""}
          </h4>
          <InsetPanel
            as="ul"
            padding="tight"
            className="max-h-40 divide-y divide-gray-100 overflow-y-auto"
          >
            {absences.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 py-1.5 text-sm"
              >
                <span className="text-gray-800 tabular-nums">
                  {formatAbsenceRange(row.date_start, row.date_end)}
                </span>
                <StatusColorBadge
                  label={absenceRowLabel(row)}
                  color={
                    ABSENCE_TYPE_HEX[row.absence_type] ??
                    LOCATION_COLORS.UNKNOWN
                  }
                />
              </li>
            ))}
          </InsetPanel>
        </section>
        <TypeChoice
          legend="Neue Art"
          name="absence-rebook-type"
          options={options}
          value={value}
          account={years[0] ? accounts.get(years[0]) : undefined}
          firstDay={firstDay}
          accountHints={accountHints}
          onChange={setValue}
        />
        {loading ? (
          <p className="text-sm text-gray-500">Folgen werden berechnet…</p>
        ) : null}
        {accountsError ? (
          <AccountsLoadError error={accountsError} onRetry={reloadAccounts} />
        ) : null}
        {preview && selected ? (
          <div className="space-y-3">
            <BalanceLine minutes={preview.balanceDeltaMinutes} />
            {allowanceProjections.length > 0 ? (
              <QuotaSummary
                label={selected.label}
                projections={allowanceProjections}
                neededLabel="Diese Änderung"
              />
            ) : null}
            {vacationProjections.length > 0 ? (
              <QuotaSummary
                label="Urlaub"
                projections={vacationProjections}
                neededLabel="Diese Änderung"
              />
            ) : null}
            {freedVacation > 0 ? (
              <p className="text-sm text-gray-600">
                {formatDayCount(freedVacation)} Urlaub werden wieder frei.
              </p>
            ) : null}
          </div>
        ) : null}
        <Input
          id="absence-rebook-reason"
          name="reason"
          label="Grund (Pflicht)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="z. B. Kontingent jetzt angelegt"
          error={formErrors.fieldError("reason")}
          disabled={saving}
        />
        <p className="text-xs text-gray-500">
          Der Grund steht danach im Änderungsprotokoll.
        </p>
      </div>
    </Modal>
  );
}
