"use client";

// „Person einstellen“ im Träger-Portal (#7206, ADR 0089 Abschnitte 1 und 3):
// Die Personalverwaltung stellt eine Person ein, die noch keine Schule kennt.
// Vier Schritte: Person, Arbeitsvertrag, Einsatzorte, Prüfen. moto legt
// danach die Akte, den Vertrag und an jeder Schule die Person an. Zugang,
// Transponder und Rolle richtet die Schule ein.

import { CheckCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Alert } from "~/components/ui/alert";
import { Avatar } from "~/components/ui/avatar";
import { Button, ButtonLink } from "~/components/ui/button";
import { CheckboxCard } from "~/components/ui/checkbox-card";
import { ConceptIconTile } from "~/components/ui/concept-icon-tile";
import { ISODatePicker } from "~/components/ui/date-picker";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerStaffKeys } from "~/lib/swr/traeger-staff-keys";
import { EmptyState } from "~/components/ui/empty-state";
import { FieldErrorHint } from "~/components/ui/field-error-hint";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { FormFieldset } from "~/components/ui/form-fieldset";
import { Input } from "~/components/ui/input";
import { InsetPanel } from "~/components/ui/inset-panel";
import { ConfirmationModal } from "~/components/ui/modal";
import {
  ResponsiveActionList,
  ResponsiveActionRow,
  ResponsiveRowActions,
} from "~/components/ui/responsive-action-list";
import { SectionCard } from "~/components/ui/section-card";
import { SectionLabel } from "~/components/ui/section-label";
import { StatusBadge } from "~/components/ui/status-badge";
import { useStepFocus } from "~/components/ui/use-step-focus";
import { WizardStepper } from "~/components/ui/wizard-stepper";
import { useApiFormError } from "~/contexts/ToastContext";
import { ApiError, wireErrorCode } from "~/lib/api-error";
import { staffConcept } from "~/lib/concepts/staff";
import { formatDate } from "~/lib/date-helpers";
import { createLogger } from "~/lib/logger";
import {
  hireStaff,
  staffHireIncomplete,
  staffHireMatches,
  type StaffHireIncomplete,
  type StaffHireMatch,
  type StaffHireMatchReason,
  type StaffRecordDetail,
} from "~/lib/traeger-staff-api";
import {
  staffCreateRecordHref,
  staffOverviewHref,
  staffSubpageHref,
  type StaffOverviewTab,
} from "./staff-overview-tab";
import { KindChoice, WeekHoursRow } from "./staff-contract-dialogs";
import {
  CONTRACT_KIND_LABELS,
  hoursLabel,
  parseHoursFields,
  weekMinutes,
  weekPattern,
} from "./staff-contract-format";
import {
  HIRE_REVIEW_STEP,
  HIRE_STEPS,
  emptyHireDraft,
  firstInvalidHireStep,
  hireInput,
  hireSite,
  hireStepErrors,
  hireStepOfField,
  hireWeekMinutes,
  type HireDraft,
} from "./staff-hire-format";

const logger = createLogger({ component: "TraegerStaffHireWizard" });

const PERSONAL = "/traeger/personal";
const CHECK_FIELDS = "Bitte prüfe die markierten Felder.";

/** Ein Satz je Schritt, unter dem Stepper der Schritt-Karte. */
const HIRE_STEP_DESCRIPTIONS = [
  "Diese Angaben stehen danach in der Personalakte.",
  "Art und Laufzeit. Die Stunden trägst du im nächsten Schritt pro Schule ein.",
  "An jeder gewählten Schule legt moto die Person an. Dort kann die Schule sie danach planen.",
  "Stimmt alles? Mit „Zurück“ änderst du eine Angabe.",
] as const;

interface School {
  readonly id: string;
  readonly name: string;
}

type FieldError = (field: string) => string | undefined;
type Change = (patch: Partial<HireDraft>) => void;

function PersonStep({
  draft,
  today,
  fieldError,
  onChange,
}: Readonly<{
  draft: HireDraft;
  today: string;
  fieldError: FieldError;
  onChange: Change;
}>) {
  return (
    <>
      <div className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          controlSize="compact"
          id="hire-first-name"
          name="first_name"
          label="Vorname"
          required
          autoComplete="off"
          maxLength={255}
          error={fieldError("first_name")}
          value={draft.firstName}
          onChange={(event) => onChange({ firstName: event.target.value })}
        />
        <Input
          controlSize="compact"
          id="hire-last-name"
          name="last_name"
          label="Nachname"
          required
          autoComplete="off"
          maxLength={255}
          error={fieldError("last_name")}
          value={draft.lastName}
          onChange={(event) => onChange({ lastName: event.target.value })}
        />
        <ISODatePicker
          id="hire-birthday"
          name="birthday"
          label="Geburtsdatum"
          required
          hint="So erkennt moto, ob es die Person schon gibt."
          error={fieldError("birthday")}
          value={draft.birthday}
          max={today}
          defaultMonth="1990-01-01"
          monthYearNavigation
          calendarLayout="popover"
          controlSize="compact"
          onChange={(birthday) => onChange({ birthday })}
        />
        <Input
          controlSize="compact"
          id="hire-personnel-number"
          name="personnel_number"
          label="Personalnummer"
          hint="Aus deinem Lohnprogramm. Geht auch später."
          inputMode="numeric"
          autoComplete="off"
          maxLength={9}
          error={fieldError("personnel_number")}
          value={draft.personnelNumber}
          onChange={(event) =>
            onChange({ personnelNumber: event.target.value })
          }
        />
        <Input
          controlSize="compact"
          id="hire-email"
          name="email"
          type="email"
          label="E-Mail"
          hint="Dorthin schickt die Schule die Einladung."
          autoComplete="off"
          error={fieldError("email")}
          value={draft.email}
          onChange={(event) => onChange({ email: event.target.value })}
        />
        <Input
          controlSize="compact"
          id="hire-phone"
          name="phone"
          type="tel"
          label="Telefon"
          autoComplete="off"
          error={fieldError("phone")}
          value={draft.phone}
          onChange={(event) => onChange({ phone: event.target.value })}
        />
      </div>
    </>
  );
}

function ContractStep({
  draft,
  fieldError,
  onChange,
}: Readonly<{
  draft: HireDraft;
  fieldError: FieldError;
  onChange: Change;
}>) {
  return (
    <>
      <div className="max-w-3xl space-y-5">
        <KindChoice
          value={draft.kind}
          onChange={(kind) => onChange({ kind })}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ISODatePicker
            id="hire-starts-on"
            monthYearNavigation
            name="starts_on"
            label="Erster Tag"
            required
            error={fieldError("starts_on")}
            value={draft.startsOn}
            calendarLayout="popover"
            controlSize="compact"
            onChange={(startsOn) => onChange({ startsOn })}
          />
          <ISODatePicker
            id="hire-ends-on"
            monthYearNavigation
            name="ends_on"
            label="Letzter Tag"
            hint="Leer lassen, wenn der Vertrag unbefristet ist."
            error={fieldError("ends_on")}
            value={draft.endsOn}
            min={draft.startsOn || undefined}
            defaultMonth={draft.startsOn || undefined}
            calendarLayout="popover"
            controlSize="compact"
            onChange={(endsOn) => onChange({ endsOn })}
          />
        </div>
      </div>
    </>
  );
}

function SitesStep({
  draft,
  schools,
  error,
  onChange,
}: Readonly<{
  draft: HireDraft;
  schools: readonly School[];
  error: string | undefined;
  onChange: Change;
}>) {
  const chosen = new Set(draft.sites.map((site) => site.schoolId));
  const toggle = (school: School, checked: boolean) =>
    onChange({
      // The chosen schools keep the order of the school list.
      sites: schools.flatMap((entry) => {
        const existing = draft.sites.find((site) => site.schoolId === entry.id);
        if (entry.id === school.id) return checked ? [hireSite(entry)] : [];
        return existing ? [existing] : [];
      }),
    });
  const total = hireWeekMinutes(draft);
  return (
    <>
      <div className="max-w-3xl space-y-5">
        <FormFieldset legend="An welchen Schulen arbeitet die Person?" required>
          <div className="grid gap-2 sm:grid-cols-2">
            {schools.map((school) => (
              <CheckboxCard
                key={school.id}
                label={school.name}
                checked={chosen.has(school.id)}
                onChange={(checked) => toggle(school, checked)}
              />
            ))}
          </div>
        </FormFieldset>
        {draft.sites.length > 0 ? (
          <div className="space-y-4">
            <div className="space-y-1">
              <SectionLabel as="h3">Soll pro Schule</SectionLabel>
              <p className="text-sm text-gray-500">
                Stunden pro Tag. Ein leeres Feld ist ein freier Tag.
              </p>
            </div>
            {draft.sites.map((site, index) => (
              <WeekHoursRow
                key={site.schoolId}
                site={{ ...site, staffId: "", before: null }}
                index={index}
                invalid={
                  error !== undefined && parseHoursFields(site.hours) === null
                }
                onChange={(hours) =>
                  onChange({
                    sites: draft.sites.map((entry) =>
                      entry.schoolId === site.schoolId
                        ? { ...entry, hours }
                        : entry,
                    ),
                  })
                }
              />
            ))}
            {draft.sites.length > 1 ? (
              <p className="flex items-baseline justify-between gap-3 border-t border-gray-100 pt-3 text-sm font-medium text-gray-900">
                <span>Alle Schulen zusammen</span>
                <span className="tabular-nums">
                  {hoursLabel(total)} pro Woche
                </span>
              </p>
            ) : null}
          </div>
        ) : null}
        <FieldErrorHint id="hire-sites-error" message={error} />
      </div>
    </>
  );
}

function ReviewStep({ draft }: Readonly<{ draft: HireDraft }>) {
  const runtime = draft.endsOn
    ? `${formatDate(draft.startsOn)} bis ${formatDate(draft.endsOn)}`
    : `ab ${formatDate(draft.startsOn)}, unbefristet`;
  return (
    <>
      <div className="max-w-3xl space-y-5">
        <DataGrid>
          <DataField label="Name">
            {draft.firstName.trim()} {draft.lastName.trim()}
          </DataField>
          <DataField label="Geburtsdatum">
            {formatDate(draft.birthday)}
          </DataField>
          <DataField
            label="Personalnummer"
            mono={Boolean(draft.personnelNumber)}
          >
            {draft.personnelNumber.trim() || "–"}
          </DataField>
          <DataField label="E-Mail">{draft.email.trim() || "–"}</DataField>
          <DataField label="Telefon">{draft.phone.trim() || "–"}</DataField>
          <DataField label="Arbeitsvertrag">
            {CONTRACT_KIND_LABELS[draft.kind]}, {runtime}
          </DataField>
          {draft.sites.map((site) => {
            const minutes = parseHoursFields(site.hours) ?? [];
            return (
              <DataField key={site.schoolId} label={site.schoolName} fullWidth>
                {weekPattern(minutes)} ({hoursLabel(weekMinutes(minutes))} pro
                Woche)
              </DataField>
            );
          })}
        </DataGrid>
        <Alert
          type="info"
          message="moto legt die Akte und den Arbeitsvertrag an. An jeder Schule entsteht die Person. Zugang, Transponder und Rolle richtet danach die Schule ein."
        />
      </div>
    </>
  );
}

const MATCH_REASON_LABELS: Record<StaffHireMatchReason, string> = {
  name_birthday: "Gleicher Name und Geburtsdatum",
  name: "Gleicher Name, Geburtsdatum fehlt",
  email: "Gleiche E-Mail-Adresse",
};

function matchName(match: StaffHireMatch, fallback: string): string {
  return `${match.firstName} ${match.lastName}`.trim() || fallback;
}

/** Eine Person, die es vielleicht schon gibt, mit Grund und nächstem Schritt. */
function DuplicateRow({
  match,
  name,
  from,
}: Readonly<{
  match: StaffHireMatch;
  name: string;
  from: StaffOverviewTab | null;
}>) {
  const shown = matchName(match, name);
  return (
    <ResponsiveActionRow className="gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <Avatar name={shown} tone="neutral" decorative />
        <div className="min-w-0 space-y-1.5">
          <p className="leading-tight">
            <span className="block truncate font-medium text-gray-900">
              {shown}
            </span>
            <span className="block text-sm text-gray-600">
              {match.kind === "record"
                ? "Hat schon eine Personalakte"
                : `${match.schoolName} · noch ohne Akte`}
            </span>
          </p>
          <ul
            className="flex flex-wrap gap-1.5"
            aria-label={`Warum moto ${shown} gefunden hat`}
          >
            {match.reasons.map((reason) => (
              <li key={reason}>
                <StatusBadge
                  tone="gray"
                  compact
                  label={MATCH_REASON_LABELS[reason]}
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
      <ResponsiveRowActions leading={32}>
        {match.kind === "record" ? (
          <ButtonLink
            href={staffSubpageHref(`${PERSONAL}/${match.recordId}`, from)}
            variant="surface"
            size="compact"
            newTab
            aria-label={`Akte von ${shown} öffnen`}
            tooltip="Öffnet die vorhandene Akte in einem neuen Tab."
          >
            Akte öffnen
          </ButtonLink>
        ) : (
          <ButtonLink
            href={staffCreateRecordHref(match.schoolId, match.staffId)}
            variant="surface"
            size="compact"
            aria-label={`Akte für ${shown} anlegen`}
            tooltip="Bricht das Einstellen ab und öffnet die Person unter „Ohne Akte“."
          >
            Akte anlegen
          </ButtonLink>
        )}
      </ResponsiveRowActions>
    </ResponsiveActionRow>
  );
}

/**
 * Die Rückfrage vor einer Dublette (#7378): Wer es vielleicht schon gibt,
 * warum moto die Person gefunden hat, und der richtige Weg. Eine Person
 * einer Schule bekommt ihre Akte unter „Ohne Akte“, nicht ein zweites Mal
 * über das Einstellen.
 */
function DuplicateBody({
  matches,
  name,
  from,
}: Readonly<{
  matches: readonly StaffHireMatch[];
  name: string;
  from: StaffOverviewTab | null;
}>) {
  const intro =
    matches.length === 1
      ? `moto hat eine Person gefunden, die ${name} sein könnte:`
      : `moto hat ${matches.length} Personen gefunden, die ${name} sein könnten:`;
  const atSchool = matches.some((match) => match.kind === "school");
  const withRecord = matches.some((match) => match.kind === "record");
  let same =
    "Dann stell sie nicht neu ein. Öffne ihre Akte und trage dort Vertrag und Schulen ein.";
  if (atSchool && withRecord) {
    same =
      "Dann stell sie nicht neu ein. Wähle bei ihr „Akte anlegen“ oder „Akte öffnen“.";
  } else if (atSchool) {
    same =
      "Dann stell sie nicht neu ein. Leg mit „Akte anlegen“ ihre Akte an. Die Person gibt es an der Schule schon.";
  }
  return (
    <div className="space-y-4 text-sm text-gray-700">
      <p>{intro}</p>
      <InsetPanel tone="white" framed padding="compact">
        <ResponsiveActionList>
          {matches.map((match) => (
            <DuplicateRow
              key={
                match.kind === "record"
                  ? `record-${match.recordId}`
                  : `school-${match.schoolId}-${match.staffId}`
              }
              match={match}
              name={name}
              from={from}
            />
          ))}
        </ResponsiveActionList>
      </InsetPanel>
      <div className="space-y-2">
        <p>
          <span className="font-medium text-gray-900">Dieselbe Person?</span>{" "}
          {same}
        </p>
        <p>
          <span className="font-medium text-gray-900">Zwei Personen?</span> Dann
          wähle „Trotzdem einstellen“.
        </p>
      </div>
    </div>
  );
}

function HiredCard({
  record,
  onRestart,
  from,
}: Readonly<{
  record: StaffRecordDetail;
  onRestart: () => void;
  from: StaffOverviewTab | null;
}>) {
  const schools = record.employments.map((site) => site.schoolName);
  return (
    <SectionCard>
      <EmptyState
        tone="success"
        titleAs="h2"
        icon={<CheckCircleIcon aria-hidden className="size-6" />}
        title={`${record.firstName} ${record.lastName} ist eingestellt.`}
        description={`Die Akte und der Arbeitsvertrag sind angelegt. ${schools.length === 1 ? `Die Schule ${schools[0]} richtet` : "Die Schulen richten"} jetzt Zugang, Transponder und Rolle ein.`}
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <ButtonLink
              href={staffSubpageHref(`${PERSONAL}/${record.id}`, from)}
              variant="primary"
              size="md"
              tooltip="Öffnet die neue Akte mit Vertrag und Einsatzorten."
            >
              Akte öffnen
            </ButtonLink>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={onRestart}
              tooltip="Leert das Formular für die nächste Person."
            >
              Weitere Person einstellen
            </Button>
          </div>
        }
      />
      {record.unsyncedSchools.length > 0 ? (
        <Alert
          type="warning"
          message={`Das Soll ist bei ${record.unsyncedSchools.join(", ")} noch nicht angekommen. Speichere später eine Änderung am Vertrag, dann holt moto es nach.`}
        />
      ) : null}
    </SectionCard>
  );
}

/**
 * Die Einstellung brach ab, nachdem moto schon etwas angelegt hat. Die Karte
 * sagt, was es gibt und wo es weitergeht, damit niemand die Person ein
 * zweites Mal einstellt.
 */
function IncompleteCard({
  name,
  incomplete,
  from,
}: Readonly<{
  name: string;
  incomplete: StaffHireIncomplete;
  from: StaffOverviewTab | null;
}>) {
  const schools = incomplete.schools.join(", ");
  const description = incomplete.recordId
    ? `Die Akte und der Arbeitsvertrag sind gespeichert. moto konnte sie nur nicht noch einmal laden. Bitte öffne die Akte und prüfe Vertrag und Schulen.`
    : `Es gibt die Person jetzt an: ${schools}. Die Akte fehlt noch. Bitte lege die Akte bei den Personalakten unter „Ohne Akte“ an und trage dort den Vertrag ein.`;
  return (
    <SectionCard>
      <EmptyState
        tone="error"
        titleAs="h2"
        icon={<WarningIcon aria-hidden className="size-6" />}
        title={`${name} ist nur zum Teil angelegt.`}
        description={`${description} Bitte stelle die Person nicht noch einmal ein.`}
        action={
          incomplete.recordId ? (
            <ButtonLink
              href={staffSubpageHref(
                `${PERSONAL}/${incomplete.recordId}`,
                from,
              )}
              variant="primary"
              size="md"
              tooltip="Öffnet die gespeicherte Akte."
            >
              Akte öffnen
            </ButtonLink>
          ) : (
            <ButtonLink
              href={staffOverviewHref("ohne-akte")}
              variant="primary"
              size="md"
              tooltip="Öffnet die Personalakten. Die Person steht dort unter „Ohne Akte“."
            >
              Zu den Personalakten
            </ButtonLink>
          )
        }
      />
    </SectionCard>
  );
}

function StepActions({
  step,
  saving,
  onBack,
  cancelHref,
}: Readonly<{
  step: number;
  saving: boolean;
  onBack: () => void;
  cancelHref: string;
}>) {
  let back: ReactNode;
  if (step === 0) {
    back = (
      <ButtonLink
        href={cancelHref}
        variant="outline"
        size="md"
        noTooltip="Abbrechen führt zurück zu den Personalakten, ohne etwas anzulegen."
      >
        Abbrechen
      </ButtonLink>
    );
  } else {
    back = (
      <Button
        type="button"
        variant="outline"
        size="md"
        onClick={onBack}
        disabled={saving}
        noTooltip="Zurück zeigt den Schritt davor; die Angaben bleiben."
      >
        Zurück
      </Button>
    );
  }
  return (
    <div className="flex justify-end gap-2">
      {back}
      {step === HIRE_REVIEW_STEP ? (
        <Button
          type="submit"
          variant="success"
          size="md"
          isLoading={saving}
          loadingText="Stellt ein…"
          tooltip="Legt die Akte, den Vertrag und an jeder Schule die Person an."
        >
          Person einstellen
        </Button>
      ) : (
        <Button
          type="submit"
          variant="primary"
          size="md"
          noTooltip="Weiter zeigt den nächsten Schritt; es wird noch nichts angelegt."
        >
          Weiter
        </Button>
      )}
    </div>
  );
}

function isCode(err: unknown, code: string): err is ApiError {
  return err instanceof ApiError && err.code === wireErrorCode(code);
}

/** Der Schritt, auf dem die Person einen abgelehnten Wert ändert. */
function stepOfRefusal(err: unknown): number {
  const field = err instanceof ApiError ? err.errors?.[0]?.field : undefined;
  return field ? hireStepOfField(field) : HIRE_REVIEW_STEP;
}

export function StaffHireWizard({
  schools,
  today,
  from,
}: Readonly<{
  schools: readonly School[];
  today: string;
  /**
   * Reiter der Personalakten, von dem man kam: Abbrechen führt dorthin,
   * und eine geöffnete Akte führt mit Zurück dorthin.
   */
  from: StaffOverviewTab | null;
}>) {
  const [draft, setDraft] = useState(() => emptyHireDraft(schools));
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [matches, setMatches] = useState<readonly StaffHireMatch[] | null>(
    null,
  );
  const [hired, setHired] = useState<StaffRecordDetail | null>(null);
  const [incomplete, setIncomplete] = useState<StaffHireIncomplete | null>(
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const errors = useApiFormError(formRef);
  const stepRef = useStepFocus<HTMLDivElement>(
    hired ? "hired" : incomplete ? "incomplete" : step,
  );

  const change: Change = (patch) => {
    // An edit answers the hint: the marks go, the next step checks again.
    if (errors.error) errors.clear();
    setDraft((current) => ({ ...current, ...patch }));
  };

  // The Personalakten list shows the new person.
  const invalidateFamily = useInvalidateFamily();
  const send = async (confirmDuplicate: boolean) => {
    if (saving) return;
    const invalidStep = firstInvalidHireStep(draft);
    if (invalidStep !== null) {
      setStep(invalidStep);
      errors.invalid(CHECK_FIELDS, hireStepErrors(draft, invalidStep));
      return;
    }
    setSaving(true);
    errors.clear();
    try {
      const record = await hireStaff(hireInput(draft, confirmDuplicate));
      void invalidateFamily(traegerStaffKeys.overviewFamily);
      setMatches(null);
      setHired(record);
    } catch (err) {
      if (isCode(err, "workforce.traeger_staff_hire_duplicate")) {
        // No failure: the person decides whether these are two people.
        setMatches(staffHireMatches(err.details));
        return;
      }
      logger.error("traeger_staff_hire_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      setMatches(null);
      if (isCode(err, "workforce.traeger_staff_hire_incomplete")) {
        // Something exists already: no form to send again.
        void invalidateFamily(traegerStaffKeys.overviewFamily);
        setIncomplete(staffHireIncomplete(err.details));
        return;
      }
      if (isCode(err, "workforce.personnel_number_taken")) {
        setStep(0);
        errors.invalid("Diese Personalnummer ist schon vergeben.", {
          personnel_number:
            "Eine andere Akte oder eine Person an der Schule hat diese Nummer.",
        });
        return;
      }
      setStep(stepOfRefusal(err));
      await errors.show(err, { object: "die Person" });
    } finally {
      setSaving(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (step === HIRE_REVIEW_STEP) {
      void send(false);
      return;
    }
    const found = hireStepErrors(draft, step);
    if (Object.keys(found).length > 0) {
      errors.invalid(CHECK_FIELDS, found);
      return;
    }
    errors.clear();
    setStep(step + 1);
  };

  const back = () => {
    errors.clear();
    setStep(step - 1);
  };

  const restart = () => {
    setDraft(emptyHireDraft(schools));
    setStep(0);
    setHired(null);
  };

  if (incomplete) {
    return (
      <div ref={stepRef} className="flex flex-col">
        <IncompleteCard
          name={`${draft.firstName.trim()} ${draft.lastName.trim()}`}
          incomplete={incomplete}
          from={from}
        />
      </div>
    );
  }

  if (hired) {
    return (
      <div ref={stepRef} className="flex flex-col">
        <HiredCard record={hired} onRestart={restart} from={from} />
      </div>
    );
  }

  return (
    <>
      {/* Ein Raster wächst nicht mit dem Seitenrumpf (TenantPage): die
          Schritt-Karte bleibt so hoch wie ihr Inhalt, Zurück und Weiter
          stehen direkt unter den Feldern. */}
      <form ref={formRef} noValidate onSubmit={submit} className="grid">
        {/* Eine Karte je Schritt: oben der Stepper, unten Zurück und
            Weiter (#7415). Der Name des Schritts steht im Stepper; die
            unsichtbare Überschrift nimmt beim Wechsel den Fokus. */}
        <SectionCard
          footer={
            <StepActions
              step={step}
              saving={saving}
              onBack={back}
              cancelHref={staffOverviewHref(from)}
            />
          }
        >
          <div ref={stepRef} className="space-y-5">
            <div className="space-y-4">
              <WizardStepper steps={HIRE_STEPS} current={step} labeled />
              <h2 className="sr-only">{HIRE_STEPS[step]}</h2>
              <p className="text-sm text-gray-600">
                {HIRE_STEP_DESCRIPTIONS[step]}
              </p>
            </div>
            <FormErrorAlert message={errors.error} />
            {step === 0 ? (
              <PersonStep
                draft={draft}
                today={today}
                fieldError={errors.fieldError}
                onChange={change}
              />
            ) : null}
            {step === 1 ? (
              <ContractStep
                draft={draft}
                fieldError={errors.fieldError}
                onChange={change}
              />
            ) : null}
            {step === 2 ? (
              <SitesStep
                draft={draft}
                schools={schools}
                error={errors.fieldError("sites")}
                onChange={change}
              />
            ) : null}
            {step === HIRE_REVIEW_STEP ? <ReviewStep draft={draft} /> : null}
          </div>
        </SectionCard>
      </form>
      <ConfirmationModal
        isOpen={matches !== null}
        onClose={() => setMatches(null)}
        onConfirm={() => void send(true)}
        title="Gibt es diese Person schon?"
        icon={<ConceptIconTile concept={staffConcept} size="sm" />}
        confirmText="Trotzdem einstellen"
        confirmVariant="warning"
        confirmTooltip="Stellt die Person als neue, zweite Person ein."
        isConfirmLoading={saving}
        loadingText="Stellt ein…"
        isBackdropDismissDisabled
      >
        <DuplicateBody
          matches={matches ?? []}
          name={`${draft.firstName.trim()} ${draft.lastName.trim()}`}
          from={from}
        />
      </ConfirmationModal>
    </>
  );
}
