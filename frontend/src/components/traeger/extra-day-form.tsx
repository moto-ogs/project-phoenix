"use client";

// Formular eines Zusatztags (#4817): ein einzelner Betreuungstag außerhalb
// der Ferien, etwa ein Brückentag oder ein beweglicher Ferientag. Ein Tag,
// eine Betreuungszeit und ein Beitrag gelten für alle gewählten Schulen.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "~/components/ui/alert";
import { Checkbox } from "~/components/ui/checkbox";
import { ChoiceTile } from "~/components/ui/choice-tile";
import { ISODateInput } from "~/components/ui/date-picker";
import { EditActions } from "~/components/ui/edit-actions";
import { FieldErrorHint } from "~/components/ui/field-error-hint";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { FormFieldset } from "~/components/ui/form-fieldset";
import { Input } from "~/components/ui/input";
import { InsetPanel } from "~/components/ui/inset-panel";
import { Radio } from "~/components/ui/radio";
import { SectionCard } from "~/components/ui/section-card";
import { SectionLabel } from "~/components/ui/section-label";
import { SwitchRow } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { TimeField } from "~/components/ui/time-field";
import { useApiFormError } from "~/contexts/ToastContext";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { useReadDraftForm } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { type DraftSource, useDraftOn } from "~/lib/swr/read-draft";
import {
  createHolidayPeriod,
  type HolidayPeriod,
  type HolidayPeriodInput,
  type TraegerSchool,
  updateHolidayPeriod,
} from "~/lib/traeger-api";
import type { TraegerCalendar } from "~/lib/traeger-closing-days";
import {
  draftFromExtraDay,
  emptyExtraDay,
  type ExtraDayDraft,
  type ExtraDayFeeMode,
  extraDayNoCare,
  extraDayServerFields,
  inputFromExtraDay,
  validateExtraDay,
} from "./extra-day-model";

const logger = createLogger({ component: "ExtraDayForm" });

const SAVE_OBJECT = "den Zusatztag";
const INVALID_DATE_TEXT =
  "Bitte gib ein gültiges Datum im Format TT.MM.JJJJ ein.";
const DATE_FIELDS = [
  "date",
  "registration_opens_on",
  "registration_closes_on",
] as const;

const FEE_MODES: readonly {
  value: ExtraDayFeeMode;
  label: string;
  description: string;
}[] = [
  {
    value: "included",
    label: "Im Monatsbeitrag enthalten",
    description: "Eltern melden nur an, dass ihr Kind kommt.",
  },
  {
    value: "day_price",
    label: "Mit Tagespreis",
    description:
      "Eltern buchen den Tag dazu. Der Preis geht in die Abrechnung der Ferienbetreuung, mit Geschwisterrabatt und Befreiung wie dort.",
  },
];

/** The same choice at a school: its Träger runs the billing (ADR 0329). */
const SCHOOL_DAY_PRICE_TEXT =
  "Eltern buchen den Tag dazu. Den Preis rechnet dein Träger ab, mit Geschwisterrabatt und Befreiung wie in der Ferienbetreuung.";

/** Where the form stores the day: the Träger-Büro's routes or the school's. */
export interface ExtraDayStore {
  readonly create: (input: HolidayPeriodInput) => Promise<HolidayPeriod>;
  readonly update: (
    id: string,
    input: HolidayPeriodInput,
    version: string,
  ) => Promise<HolidayPeriod>;
}

const TRAEGER_STORE: ExtraDayStore = {
  create: (input) => createHolidayPeriod(input),
  update: (id, input, version) => updateHolidayPeriod(id, input, version),
};

/** No day to change: the form creates one and sends no version. */
const NEW_DAY: DraftSource<HolidayPeriod> = {
  opening: null,
  data: undefined,
  reload: () => Promise.resolve(undefined),
};

export function ExtraDayForm({
  period,
  schools,
  onSaved,
  onCancel,
  onDirtyChange,
  calendar,
  reload,
  store = TRAEGER_STORE,
  ownSchool = false,
}: Readonly<{
  /** The stored day; without it the form creates a new one. */
  period?: HolidayPeriod;
  schools: readonly TraegerSchool[];
  onSaved: (period: HolidayPeriod) => void;
  onCancel: () => void;
  /** Reports whether the form holds unsaved changes. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Holidays and Träger closing days for the hint at the day (#4702). */
  calendar?: TraegerCalendar;
  /**
   * Reads the stored day again and rejects when that fails: after a refused
   * save the form shows it (ADR 0311).
   */
  reload?: () => Promise<HolidayPeriod>;
  /** The routes that store the day; the Träger-Büro's without it. */
  store?: ExtraDayStore;
  /**
   * The school plans the day for itself (ADR 0329): `schools` is that one
   * school, it is always chosen and the form asks for no school.
   */
  ownSchool?: boolean;
}>) {
  const formRef = useRef<HTMLFormElement>(null);
  const today = useBerlinToday();
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
  const dayValidity = useCallback(
    (valid: boolean) => markDate("date", valid),
    [markDate],
  );
  const opensValidity = useCallback(
    (valid: boolean) => markDate("registration_opens_on", valid),
    [markDate],
  );
  const closesValidity = useCallback(
    (valid: boolean) => markDate("registration_closes_on", valid),
    [markDate],
  );
  const hasInvalidDate = invalidDates.size > 0;
  // An edit rests on the version read when editing starts (ADR 0311), as in
  // the holiday period form.
  const editor = useDraftOn<
    HolidayPeriod,
    ExtraDayDraft,
    string,
    HolidayPeriod
  >(
    period
      ? {
          opening: period.id,
          data: period,
          reload: reload ?? (() => Promise.resolve(undefined)),
        }
      : NEW_DAY,
    {
      token: (stored) => stored.version,
      toDraft: draftFromExtraDay,
      answer: (stored) => stored,
      follow: !hasInvalidDate,
    },
  );
  const [blank, setBlank] = useState<ExtraDayDraft>(() => ({
    ...emptyExtraDay(today),
    schoolIds: ownSchool ? schools.map((school) => school.id) : [],
  }));
  const [blankEdited, setBlankEdited] = useState(false);
  const draft = (period ? editor.draft : undefined) ?? blank;
  const edited = period ? editor.touched : blankEdited;
  const errorPath = useApiFormError(formRef);
  const form = useReadDraftForm(period ? editor : null, errorPath, SAVE_OBJECT);
  useEffect(() => {
    onDirtyChange?.(edited || hasInvalidDate);
  }, [edited, hasInvalidDate, onDirtyChange]);

  // The form's own check names the control; a refusal of the backend names
  // the week of a school by position.
  const fieldError = (control: string): string | null => {
    for (const name of [
      control,
      ...extraDayServerFields(control, draft.schoolIds.length),
    ]) {
      const message = errorPath.fieldError(name);
      if (message) return message;
    }
    return null;
  };

  const setDraft = (next: ExtraDayDraft) => {
    if (period) {
      editor.setDraft(next);
      return;
    }
    setBlank(next);
    setBlankEdited(true);
  };

  const noCare = useMemo(
    () => extraDayNoCare(draft.date, draft.schoolIds, calendar),
    [draft.date, draft.schoolIds, calendar],
  );
  const schoolName = (id: string) =>
    schools.find((school) => school.id === id)?.name ?? "Schule";
  const allSelected =
    schools.length > 0 && draft.schoolIds.length === schools.length;
  // The stored day of a school has bookings once a child has a place there.
  const bookedSchools = new Set(
    (period?.weeks ?? [])
      .filter((week) => week.timeModels.some((model) => model.protected))
      .map((week) => week.hostSchoolId),
  );
  const toggleSchool = (id: string, selected: boolean) =>
    setDraft({
      ...draft,
      // Kept in the order of the list, whatever the order of the clicks.
      schoolIds: schools
        .map((school) => school.id)
        .filter((schoolId) =>
          schoolId === id ? selected : draft.schoolIds.includes(schoolId),
        ),
    });

  const save = async () => {
    if (!form.begin()) return;
    const errors = validateExtraDay(draft);
    for (const name of DATE_FIELDS) {
      if (invalidDates.has(name)) errors[name] = INVALID_DATE_TEXT;
    }
    if (Object.keys(errors).length > 0) {
      errorPath.invalid("Bitte prüfe die markierten Felder.", errors);
      return;
    }
    setSaving(true);
    try {
      if (!period) {
        let saved: HolidayPeriod;
        try {
          saved = await store.create(inputFromExtraDay(draft));
        } catch (err) {
          logger.error("extra_day_save_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
          void errorPath.show(err, { object: SAVE_OBJECT });
          return;
        }
        setBlank(draftFromExtraDay(saved));
        setBlankEdited(false);
        onSaved(saved);
        return;
      }
      const result = await editor.submit((version, next) =>
        store.update(period.id, inputFromExtraDay(next, period), version),
      );
      if (result.ok) {
        onSaved(result.saved);
        return;
      }
      logger.error("extra_day_save_failed", {
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      const reread = result.reload;
      void errorPath.show(result.error, {
        object: SAVE_OBJECT,
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

  // Parents register under the fee mode of a published day: it stays.
  const feeLocked = period?.status === "published";
  const lunchBooked = (period?.weeks ?? []).some((week) => week.lunchBooked);
  const included = draft.feeMode === "included";
  const startsError = fieldError("starts_at");
  const endsError = fieldError("ends_at");
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

      <SectionCard
        title="Tag, Betreuung und Beitrag"
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Input
                controlSize="compact"
                name="name"
                label="Name des Zusatztags"
                required
                placeholder="z. B. Brückentag nach Himmelfahrt"
                value={draft.name}
                maxLength={120}
                error={fieldError("name") ?? undefined}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
              <div>
                <ISODateInput
                  id="date"
                  label="Tag"
                  required
                  // Only a new day must lie ahead: a stored day that has
                  // passed stays editable, for example its name.
                  {...(period
                    ? {}
                    : {
                        min: today,
                        minDateError:
                          "Der Zusatztag liegt in der Vergangenheit.",
                      })}
                  value={draft.date}
                  error={fieldError("date")}
                  onValidityChange={dayValidity}
                  onChange={(date) => setDraft({ ...draft, date })}
                />
              </div>
            </div>

            {ownSchool ? null : (
              <FormFieldset
                legend="Schulen"
                required
                hint="An jeder gewählten Schule gibt es an diesem Tag Betreuung. Eltern wählen bei der Anmeldung eine davon."
                error={fieldError("schools")}
              >
                <div className="space-y-2">
                  {schools.length > 1 ? (
                    <ChoiceTile selected={allSelected} className="px-3 py-2.5">
                      <Checkbox
                        name="schools"
                        checked={allSelected}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            schoolIds: event.target.checked
                              ? schools.map((school) => school.id)
                              : // A school with bookings stays chosen.
                                draft.schoolIds.filter((id) =>
                                  bookedSchools.has(id),
                                ),
                          })
                        }
                      />
                      <span className="text-sm font-semibold text-gray-900">
                        Alle Schulen
                      </span>
                    </ChoiceTile>
                  ) : null}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {schools.map((school) => {
                      const selected = draft.schoolIds.includes(school.id);
                      const booked = bookedSchools.has(school.id);
                      return (
                        <ChoiceTile
                          key={school.id}
                          selected={selected}
                          disabled={booked}
                          className="px-3 py-2.5"
                        >
                          <Checkbox
                            name={schools.length > 1 ? undefined : "schools"}
                            checked={selected}
                            disabled={booked}
                            onChange={(event) =>
                              toggleSchool(school.id, event.target.checked)
                            }
                          />
                          <span className="min-w-0">
                            <span className="block text-sm wrap-anywhere text-gray-900">
                              {school.name}
                            </span>
                            {booked ? (
                              <span className="block text-xs font-normal text-gray-600">
                                Hat schon Anmeldungen und bleibt gewählt.
                              </span>
                            ) : null}
                          </span>
                        </ChoiceTile>
                      );
                    })}
                  </div>
                </div>
              </FormFieldset>
            )}

            {noCare.length > 0 ? (
              <Alert
                type="warning"
                title="An diesem Tag gibt es dort keine Betreuung"
                message={
                  <ul className="list-disc space-y-1 pl-5">
                    {noCare.map((entry) => (
                      <li key={entry.schoolId}>
                        {schoolName(entry.schoolId)}:{" "}
                        {entry.kind === "holiday"
                          ? `Feiertag „${entry.name}“. An einem Feiertag kannst du keinen Zusatztag anlegen.`
                          : `Schließtag „${entry.name}“. Nimm die Schule zuerst aus dem Schließtag heraus oder wähle sie hier ab.`}
                      </li>
                    ))}
                  </ul>
                }
              />
            ) : null}
          </div>

          <div className="space-y-4 border-t border-gray-200 pt-6">
            <div>
              <SectionLabel as="h3">Betreuungszeit</SectionLabel>
              <p className="text-sm text-gray-600">
                Von wann bis wann ist die Betreuung an diesem Tag geöffnet?
                {ownSchool
                  ? null
                  : " Die Zeit gilt für alle gewählten Schulen."}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:max-w-md">
              <div>
                <TimeField
                  name="starts_at"
                  label="Beginn"
                  required
                  hint={draft.startsAt ? "" : "z. B. 07:30"}
                  placeholder=""
                  value={draft.startsAt}
                  invalid={Boolean(startsError)}
                  describedBy={startsError ? "starts_at-error" : undefined}
                  onChange={(startsAt) => setDraft({ ...draft, startsAt })}
                />
                <FieldErrorHint id="starts_at-error" message={startsError} />
              </div>
              <div>
                <TimeField
                  name="ends_at"
                  label="Ende"
                  required
                  hint={draft.endsAt ? "" : "z. B. 16:00"}
                  placeholder=""
                  value={draft.endsAt}
                  invalid={Boolean(endsError)}
                  describedBy={endsError ? "ends_at-error" : undefined}
                  onChange={(endsAt) => setDraft({ ...draft, endsAt })}
                />
                <FieldErrorHint id="ends_at-error" message={endsError} />
              </div>
            </div>
          </div>

          <div className="space-y-4 border-t border-gray-200 pt-6">
            <div>
              <SectionLabel as="h3">Anmeldung</SectionLabel>
              <p className="text-sm text-gray-600">
                In dieser Zeit können Eltern ihr Kind anmelden: über den Link
                des Zusatztags oder in der Eltern-App. Der Anmeldeschluss liegt
                spätestens am Zusatztag selbst.
              </p>
            </div>
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
          </div>

          <div className="space-y-4 border-t border-gray-200 pt-6">
            <FormFieldset
              legend="Beitrag"
              required
              hint={
                feeLocked
                  ? "Der Zusatztag ist veröffentlicht. Eltern haben sich auf diesen Beitrag verlassen, deshalb lässt er sich nicht mehr umstellen."
                  : "Was kostet der Zusatztag die Eltern?"
              }
              error={fieldError("fee_mode")}
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {FEE_MODES.map((mode) => (
                  <ChoiceTile
                    key={mode.value}
                    selected={draft.feeMode === mode.value}
                    disabled={feeLocked}
                    className="items-start p-3"
                  >
                    <Radio
                      name="fee_mode"
                      value={mode.value}
                      disabled={feeLocked}
                      checked={draft.feeMode === mode.value}
                      className="mt-0.5"
                      onChange={() =>
                        setDraft({ ...draft, feeMode: mode.value })
                      }
                    />
                    <span className="min-w-0">
                      <span className="block text-gray-900">{mode.label}</span>
                      <span className="block font-normal text-gray-600">
                        {ownSchool && mode.value === "day_price"
                          ? SCHOOL_DAY_PRICE_TEXT
                          : mode.description}
                      </span>
                    </span>
                  </ChoiceTile>
                ))}
              </div>
            </FormFieldset>
            {draft.feeMode === "day_price" ? (
              <Input
                controlSize="compact"
                name="price"
                label="Preis pro Tag in Euro"
                required
                inputMode="decimal"
                placeholder="z. B. 18,00"
                className="sm:max-w-xs"
                value={draft.price}
                error={fieldError("price") ?? undefined}
                onChange={(event) =>
                  setDraft({ ...draft, price: event.target.value })
                }
              />
            ) : (
              <InsetPanel tone="muted" padding="sm" as="p">
                <span className="text-sm text-gray-700">
                  Eltern sehen bei der Anmeldung keinen Preis, sondern den
                  Hinweis „Im Monatsbeitrag enthalten“. Der Zusatztag steht in
                  keiner Abrechnung.
                </span>
              </InsetPanel>
            )}
          </div>

          <div className="space-y-4 border-t border-gray-200 pt-6">
            <SectionLabel as="h3">Mittagessen</SectionLabel>
            <SwitchRow
              label="Mittagessen anbieten"
              description={
                lunchBooked
                  ? "Für diesen Tag ist schon Mittagessen gebucht. Das Angebot bleibt deshalb."
                  : included
                    ? "Eltern wählen das Essen pro Kind dazu. Es kostet nichts extra. Die Schule sieht, wie viele Essen sie braucht."
                    : "Eltern wählen das Essen pro Kind dazu. Es steht als eigener Betrag auf der Rechnung. Die Schule sieht, wie viele Essen sie braucht."
              }
              checked={draft.lunchOffered}
              disabled={lunchBooked}
              onCheckedChange={(lunchOffered) =>
                setDraft({ ...draft, lunchOffered })
              }
            />
            {draft.lunchOffered && !included ? (
              <Input
                controlSize="compact"
                name="lunch_price"
                label="Preis für ein Essen in Euro"
                required
                inputMode="decimal"
                placeholder="z. B. 4,30"
                className="sm:max-w-xs"
                value={draft.lunchPrice}
                error={fieldError("lunch_price") ?? undefined}
                onChange={(event) =>
                  setDraft({ ...draft, lunchPrice: event.target.value })
                }
              />
            ) : null}
          </div>

          <div className="border-t border-gray-200 pt-6">
            <Textarea
              name="notes"
              label="Hinweise für Eltern"
              rows={3}
              maxLength={2000}
              placeholder="Zum Beispiel: Bitte gebt ein Frühstück und ein Mittagessen mit."
              value={draft.notes}
              error={fieldError("notes") ?? undefined}
              onChange={(event) =>
                setDraft({ ...draft, notes: event.target.value })
              }
            />
          </div>
        </fieldset>
      </SectionCard>
    </form>
  );
}
