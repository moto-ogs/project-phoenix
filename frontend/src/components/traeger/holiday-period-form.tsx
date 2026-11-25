"use client";

// Formular eines Ferienzeitraums (#4659): Anmeldung, Hinweise für Eltern,
// die buchbaren Wochen mit ausrichtender OGS und Zeitmodellen und der Text
// der Annahme-Mail (#6672).

import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ButtonLink } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { ISODateInput } from "~/components/ui/date-picker";
import { EditActions } from "~/components/ui/edit-actions";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { Input } from "~/components/ui/input";
import { SectionCard } from "~/components/ui/section-card";
import { SectionLabel } from "~/components/ui/section-label";
import { SwitchRow } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { useApiFormError } from "~/contexts/ToastContext";
import { useReadDraftForm } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { type DraftSource, useDraftOn } from "~/lib/swr/read-draft";
import { TRAEGER_HOLIDAY_TAB } from "~/lib/traeger-payment-text";
import { traegerPath } from "~/lib/traeger-url";
import {
  createHolidayPeriod,
  type HolidayPeriod,
  type TraegerSchool,
  updateHolidayPeriod,
} from "~/lib/traeger-api";
import {
  draftFromPeriod,
  emptyHolidayPeriod,
  emptyWeek,
  type HolidayPeriodDraft,
  inputFromDraft,
  MAX_HOLIDAY_WEEKS,
  validateHolidayPeriod,
  type WeekDraft,
} from "./holiday-period-model";
import { HolidayAcceptanceMailField } from "./holiday-acceptance-mail-field";
import { HolidayAllocationModeField } from "./holiday-allocation-mode-field";
import { HolidayWeekEditor } from "./holiday-week-editor";
import type { HolidayCriterion } from "~/lib/traeger-holiday-allocation-api";
import { weekNoCareDays } from "./use-week-no-care-days";
import type { TraegerCalendar } from "~/lib/traeger-closing-days";

const logger = createLogger({ component: "HolidayPeriodForm" });

const INVALID_DATE_TEXT =
  "Bitte gib ein gültiges Datum im Format TT.MM.JJJJ ein.";

/**
 * Date fields whose typed text is no valid date. The draft keeps the last
 * valid value of such a field, so saving waits until the text is fixed.
 * Week fields are keyed by the week's stable key, so removing a week does
 * not shift them onto its neighbour.
 */
function invalidDateFields(
  invalid: ReadonlySet<string>,
  draft: HolidayPeriodDraft,
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const name of ["registration_opens_on", "registration_closes_on"]) {
    if (invalid.has(name)) fields[name] = INVALID_DATE_TEXT;
  }
  draft.weeks.forEach((week, index) => {
    for (const field of ["starts_on", "ends_on"]) {
      if (invalid.has(`${week.key}:${field}`)) {
        fields[`weeks.${index}.${field}`] = INVALID_DATE_TEXT;
      }
    }
  });
  return fields;
}

/** No period to change: the form creates one and sends no version. */
const NEW_PERIOD: DraftSource<HolidayPeriod> = {
  opening: null,
  data: undefined,
  reload: () => Promise.resolve(undefined),
};

export function HolidayPeriodForm({
  period,
  schools,
  onSaved,
  onCancel,
  onDirtyChange,
  calendar,
  criteria,
  reload,
}: Readonly<{
  /** The stored period; without it the form creates a new one. */
  period?: HolidayPeriod;
  schools: readonly TraegerSchool[];
  onSaved: (period: HolidayPeriod) => void;
  onCancel: () => void;
  /** Reports whether the form holds unsaved changes. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Holidays and Träger closing days for the hints at each week (#4702). */
  calendar?: TraegerCalendar;
  /** The Träger's criteria for the hint at the allocation (#4700). */
  criteria?: readonly HolidayCriterion[];
  /**
   * Reads the stored period again and rejects when that fails: after a
   * refused save the form shows it (ADR 0311).
   */
  reload?: () => Promise<HolidayPeriod>;
}>) {
  const formRef = useRef<HTMLFormElement>(null);
  const [saving, setSaving] = useState(false);
  const [invalidDates, setInvalidDates] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Stable callbacks: the date field re-reports its validity whenever the
  // callback changes, which would clear a flag the typed text just set.
  const markDate = useCallback(
    (key: string, valid: boolean) =>
      setInvalidDates((current) => {
        if (current.has(key) === !valid) return current;
        const next = new Set(current);
        if (valid) next.delete(key);
        else next.add(key);
        return next;
      }),
    [],
  );
  const opensValidity = useCallback(
    (valid: boolean) => markDate("registration_opens_on", valid),
    [markDate],
  );
  const closesValidity = useCallback(
    (valid: boolean) => markDate("registration_closes_on", valid),
    [markDate],
  );
  // A date field whose text is no valid date holds an unsaved change: the
  // stored period no longer matches what the person sees.
  const hasInvalidDate = invalidDates.size > 0;
  // An edit rests on the version read when editing starts (ADR 0311): a
  // newer read refills only an untouched draft (typed text that is no valid
  // date counts as touched), the save sends that version and its answer is
  // the new base, and after a refusal the stored period shows. Nothing is
  // sent until it was read.
  const editor = useDraftOn<
    HolidayPeriod,
    HolidayPeriodDraft,
    string,
    HolidayPeriod
  >(
    period
      ? {
          opening: period.id,
          data: period,
          reload: reload ?? (() => Promise.resolve(undefined)),
        }
      : NEW_PERIOD,
    {
      token: (stored) => stored.version,
      toDraft: draftFromPeriod,
      answer: (stored) => stored,
      follow: !hasInvalidDate,
    },
  );
  const [blank, setBlank] = useState<HolidayPeriodDraft>(emptyHolidayPeriod);
  const [blankEdited, setBlankEdited] = useState(false);
  const draft = (period ? editor.draft : undefined) ?? blank;
  const edited = period ? editor.touched : blankEdited;
  const errorPath = useApiFormError(formRef);
  const form = useReadDraftForm(
    period ? editor : null,
    errorPath,
    "die Planung des Ferienzeitraums",
  );
  useEffect(() => {
    onDirtyChange?.(edited || hasInvalidDate);
  }, [edited, hasInvalidDate, onDirtyChange]);
  const weekDateValidity = useCallback(
    (weekKey: string, field: "starts_on" | "ends_on", valid: boolean) =>
      markDate(`${weekKey}:${field}`, valid),
    [markDate],
  );
  const fieldError = (name: string) => errorPath.fieldError(name);
  const noCareDays = useMemo(
    () => weekNoCareDays(draft.weeks, calendar, period),
    [draft.weeks, calendar, period],
  );

  const setDraft = (next: HolidayPeriodDraft) => {
    if (period) {
      editor.setDraft(next);
      return;
    }
    setBlank(next);
    setBlankEdited(true);
  };
  const setWeek = (index: number, week: WeekDraft) =>
    setDraft({
      ...draft,
      weeks: draft.weeks.map((current, i) => (i === index ? week : current)),
    });

  const save = async () => {
    // Enter submits too: nothing goes out before the stored period is read,
    // and the shown error stays.
    if (!form.begin()) return;
    const errors = {
      ...validateHolidayPeriod(draft),
      ...invalidDateFields(invalidDates, draft),
    };
    if (Object.keys(errors).length > 0) {
      errorPath.invalid("Bitte prüfe die markierten Felder.", errors);
      return;
    }
    setSaving(true);
    try {
      if (!period) {
        let saved: HolidayPeriod;
        try {
          saved = await createHolidayPeriod(inputFromDraft(draft));
        } catch (err) {
          logger.error("holiday_period_save_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
          void errorPath.show(err, {
            object: "die Planung des Ferienzeitraums",
          });
          return;
        }
        setBlank(draftFromPeriod(saved));
        setBlankEdited(false);
        onSaved(saved);
        return;
      }
      const result = await editor.submit((version, next) =>
        updateHolidayPeriod(period.id, inputFromDraft(next), version),
      );
      if (result.ok) {
        onSaved(result.saved);
        return;
      }
      logger.error("holiday_period_save_failed", {
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      // Changed since it was read: the stored period replaces the draft once
      // it is read, without offering the same save again. A failed read
      // shows as a load error with a retry of the read alone.
      const reread = result.reload;
      void errorPath.show(result.error, {
        object: "die Planung des Ferienzeitraums",
        ...(reread
          ? {
              reload: async () => {
                const stored = await reread();
                setInvalidDates(new Set());
                return stored;
              },
            }
          : {}),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      ref={formRef}
      noValidate
      className="compact:space-y-4 space-y-6 max-sm:space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <FormErrorAlert message={errorPath.error} />
      <LoadErrorAlert error={form.loadError} />

      {/* The save stays in the form's card and in view while the long form
          scrolls. */}
      <SectionCard
        title="Anmeldung und Wochen"
        stickyFooter
        footer={
          <EditActions
            onCancel={onCancel}
            saving={saving}
            saveType="submit"
            {...(period && !editor.canSubmit && editor.status !== "saving"
              ? {
                  disabled: true,
                  disabledReason:
                    editor.status === "loadFailed"
                      ? "Lade zuerst den gespeicherten Stand neu."
                      : "Der gespeicherte Stand wird geladen.",
                }
              : {})}
          />
        }
      >
        {/* Locked while saving: the answer replaces the draft, so an edit made
            meanwhile would be lost. */}
        <fieldset disabled={saving} className="min-w-0 space-y-6">
          <div className="space-y-4">
            <Input
              controlSize="compact"
              name="name"
              label="Name des Ferienzeitraums"
              required
              placeholder="z. B. Osterferien 2027"
              value={draft.name}
              maxLength={120}
              error={fieldError("name") ?? undefined}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <ISODateInput
                  id="registration_opens_on"
                  label="Anmeldebeginn"
                  required
                  value={draft.registrationOpensOn}
                  error={fieldError("registration_opens_on")}
                  onValidityChange={opensValidity}
                  onChange={(registrationOpensOn) =>
                    setDraft({ ...draft, registrationOpensOn })
                  }
                />
              </div>
              <div>
                <ISODateInput
                  id="registration_closes_on"
                  label="Anmeldeschluss"
                  required
                  value={draft.registrationClosesOn}
                  error={fieldError("registration_closes_on")}
                  onValidityChange={closesValidity}
                  onChange={(registrationClosesOn) =>
                    setDraft({ ...draft, registrationClosesOn })
                  }
                />
              </div>
            </div>
            <label htmlFor="binding" className="flex items-start gap-3">
              <Checkbox
                id="binding"
                name="binding"
                checked={draft.binding}
                onChange={(event) =>
                  setDraft({ ...draft, binding: event.target.checked })
                }
              />
              <span className="text-sm text-gray-900">
                Die Anmeldung ist verbindlich.
              </span>
            </label>
            <Input
              controlSize="compact"
              name="max_days_per_child"
              label="Höchstzahl an Tagen pro Kind"
              hint="Gilt für alle Wochen zusammen. Eltern dürfen die Tage verteilen. Wenn es keine Grenze gibt, lass das Feld leer."
              inputMode="numeric"
              placeholder="zum Beispiel 5"
              className="sm:max-w-xs"
              value={draft.maxDaysPerChild}
              error={fieldError("max_days_per_child") ?? undefined}
              onChange={(event) =>
                setDraft({ ...draft, maxDaysPerChild: event.target.value })
              }
            />
            <SwitchRow
              label="Ferienwunsch aus der OGS-Anmeldung berücksichtigen"
              description={
                <>
                  Eltern geben in der OGS-Anmeldung an, ob ihr Kind
                  Ferienbetreuung braucht. Ist der Schalter an, haben Kinder mit
                  diesem Ferienwunsch Vorrang, wenn eine Woche voll ist. Oder
                  nur sie können sich anmelden: Das legst du in den{" "}
                  {/* In a form a link opens a new tab, so the unsaved
                      draft stays (Bauart 1 R9). */}
                  <ButtonLink
                    href={traegerPath(
                      `/traeger/einstellungen?bereich=${TRAEGER_HOLIDAY_TAB}`,
                    )}
                    newTab
                    variant="link"
                    // In running text the link stays recognisable at rest.
                    className="underline underline-offset-2"
                    tooltip="Öffnet die Einstellungen der Ferien in einem neuen Tab."
                  >
                    Einstellungen
                  </ButtonLink>{" "}
                  fest. Für Feriengäste ändert sich nichts.
                </>
              }
              checked={draft.holidayWishRule}
              onCheckedChange={(holidayWishRule) =>
                setDraft({ ...draft, holidayWishRule })
              }
            />
            <Textarea
              name="notes"
              label="Hinweise für Eltern"
              rows={3}
              maxLength={2000}
              placeholder="Zum Beispiel: Mittagessen gibt es vor Ort. Oder: Bitte gebt ein Lunchpaket mit."
              value={draft.notes}
              error={fieldError("notes") ?? undefined}
              onChange={(event) =>
                setDraft({ ...draft, notes: event.target.value })
              }
            />
          </div>

          <div className="border-t border-gray-200 pt-6">
            <HolidayAllocationModeField
              value={draft.allocationMode}
              locked={period?.allocationModeLocked ?? false}
              criteria={criteria}
              onChange={(allocationMode) =>
                setDraft({ ...draft, allocationMode })
              }
            />
          </div>

          <div className="space-y-4 border-t border-gray-200 pt-6">
            <div>
              <SectionLabel as="h3">Wochen</SectionLabel>
              <p className="text-sm text-gray-600">
                Jede Woche findet an einer Schule deines Trägers statt. Willst
                du dieselben Tage an mehreren Schulen anbieten? Lege dafür pro
                Schule eine Woche an. Eltern wählen dann eine Schule.
              </p>
              {/* What a booked time model allows is said only where one
                  exists: a new period has none. */}
              <p className="mt-2 text-sm text-gray-600">
                Jede Woche hat Zeitmodelle, zum Beispiel „bis 13 Uhr“ und „bis
                16 Uhr“, jedes mit eigenem Preis.
                {draft.weeks.some((week) =>
                  week.timeModels.some((model) => model.protected),
                )
                  ? " Ein gebuchtes Zeitmodell archivierst du: die Buchungen bleiben. Ein ungebuchtes entfernst du mit „×“."
                  : ""}
                {draft.weeks.some((week) =>
                  week.timeModels.some(
                    (model) => model.protected && !model.archived,
                  ),
                )
                  ? " Ein neuer Preis eines gebuchten Zeitmodells gilt für Anmeldungen, die du danach bestätigst. Bestätigte behalten ihren Betrag."
                  : ""}
              </p>
            </div>
            <div className="space-y-4">
              {draft.weeks.length === 0 ? (
                <p className="text-sm text-gray-600">
                  Noch keine Woche. Zum Veröffentlichen braucht der
                  Ferienzeitraum mindestens eine Woche.
                </p>
              ) : (
                draft.weeks.map((week, index) => (
                  <HolidayWeekEditor
                    key={week.key}
                    index={index}
                    week={week}
                    schools={schools}
                    noCareDays={noCareDays.get(week.key)}
                    fieldError={fieldError}
                    onChange={(next) => setWeek(index, next)}
                    onDateValidity={weekDateValidity}
                    onRemove={() => {
                      // The week's date flags go with it, so a later invalid
                      // date of another week reports again.
                      setInvalidDates((current) => {
                        const prefix = `${week.key}:`;
                        if (
                          ![...current].some((key) => key.startsWith(prefix))
                        ) {
                          return current;
                        }
                        return new Set(
                          [...current].filter((key) => !key.startsWith(prefix)),
                        );
                      });
                      setDraft({
                        ...draft,
                        weeks: draft.weeks.filter((_, i) => i !== index),
                      });
                    }}
                  />
                ))
              )}
            </div>
            {draft.weeks.length < MAX_HOLIDAY_WEEKS ? (
              <Button
                type="button"
                variant="outline"
                size="md"
                className="gap-2"
                tooltip="Fügt unten eine leere Woche an, wirksam erst nach dem Speichern."
                onClick={() =>
                  setDraft({ ...draft, weeks: [...draft.weeks, emptyWeek()] })
                }
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Woche hinzufügen
              </Button>
            ) : (
              <p className="text-sm text-gray-600">
                Ein Ferienzeitraum hat höchstens {MAX_HOLIDAY_WEEKS} Wochen.
              </p>
            )}
          </div>

          <div className="border-t border-gray-200 pt-6">
            <HolidayAcceptanceMailField
              draft={draft}
              schools={schools}
              error={fieldError("acceptance_mail_text") ?? undefined}
              onChange={(acceptanceMailText) =>
                setDraft({ ...draft, acceptanceMailText })
              }
            />
          </div>
        </fieldset>
      </SectionCard>
    </form>
  );
}
