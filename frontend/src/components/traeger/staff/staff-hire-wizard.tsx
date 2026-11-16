"use client";

// „Person einstellen“ im Träger-Portal (#7206, ADR 0089 Abschnitte 1 und 3):
// Die Personalverwaltung stellt eine Person ein, die noch keine Schule kennt.
// Vier Schritte: Person, Arbeitsvertrag, Einsatzorte, Prüfen. moto legt
// danach die Akte, den Vertrag und an jeder Schule die Person an. Zugang,
// Transponder und Rolle richtet die Schule ein.

import { CheckCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Alert } from "~/components/ui/alert";
import { Button, ButtonLink } from "~/components/ui/button";
import { CheckboxCard } from "~/components/ui/checkbox-card";
import { ISODatePicker } from "~/components/ui/date-picker";
import { DataField, DataGrid } from "~/components/ui/detail-modal-components";
import { EmptyState } from "~/components/ui/empty-state";
import { FieldErrorHint } from "~/components/ui/field-error-hint";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { FormFieldset } from "~/components/ui/form-fieldset";
import { Input } from "~/components/ui/input";
import { ConfirmationModal } from "~/components/ui/modal";
import { SectionCard } from "~/components/ui/section-card";
import { SectionLabel } from "~/components/ui/section-label";
import { useStepFocus } from "~/components/ui/use-step-focus";
import { WizardStepper } from "~/components/ui/wizard-stepper";
import { useApiFormError } from "~/contexts/ToastContext";
import { ApiError, wireErrorCode } from "~/lib/api-error";
import { formatDate } from "~/lib/date-helpers";
import { createLogger } from "~/lib/logger";
import {
  hireStaff,
  staffHireIncomplete,
  staffHireMatches,
  type StaffHireIncomplete,
  type StaffHireMatch,
  type StaffRecordDetail,
} from "~/lib/traeger-staff-api";
import { traegerPath } from "~/lib/traeger-url";
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
const CHECK_FIELDS = "Bitte prüfen Sie die markierten Felder.";

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
    <SectionCard
      title="Person"
      description="Diese Angaben stehen danach in der Personalakte."
    >
      <div className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
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
          controlSize="large"
          onChange={(birthday) => onChange({ birthday })}
        />
        <Input
          id="hire-personnel-number"
          name="personnel_number"
          label="Personalnummer"
          hint="Aus Ihrem Lohnprogramm. Geht auch später."
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
    </SectionCard>
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
    <SectionCard
      title="Arbeitsvertrag"
      description="Art und Laufzeit. Die Stunden tragen Sie im nächsten Schritt je Schule ein."
    >
      <div className="max-w-3xl space-y-5">
        <KindChoice
          value={draft.kind}
          onChange={(kind) => onChange({ kind })}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ISODatePicker
            id="hire-starts-on"
            name="starts_on"
            label="Erster Tag"
            required
            error={fieldError("starts_on")}
            value={draft.startsOn}
            calendarLayout="popover"
            controlSize="large"
            onChange={(startsOn) => onChange({ startsOn })}
          />
          <ISODatePicker
            id="hire-ends-on"
            name="ends_on"
            label="Letzter Tag"
            hint="Leer lassen, wenn der Vertrag unbefristet ist."
            error={fieldError("ends_on")}
            value={draft.endsOn}
            min={draft.startsOn || undefined}
            defaultMonth={draft.startsOn || undefined}
            calendarLayout="popover"
            controlSize="large"
            onChange={(endsOn) => onChange({ endsOn })}
          />
        </div>
      </div>
    </SectionCard>
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
    <SectionCard
      title="Einsatzorte"
      description="An jeder gewählten Schule legt moto die Person an. Dort kann die Schule sie danach planen."
    >
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
              <SectionLabel as="h3">Soll je Schule</SectionLabel>
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
    </SectionCard>
  );
}

function ReviewStep({ draft }: Readonly<{ draft: HireDraft }>) {
  const runtime = draft.endsOn
    ? `${formatDate(draft.startsOn)} bis ${formatDate(draft.endsOn)}`
    : `ab ${formatDate(draft.startsOn)}, unbefristet`;
  return (
    <SectionCard
      title="Prüfen"
      description="Stimmt alles? Mit „Zurück“ ändern Sie eine Angabe."
    >
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
    </SectionCard>
  );
}

function DuplicateBody({
  matches,
}: Readonly<{ matches: readonly StaffHireMatch[] }>) {
  return (
    <div className="space-y-3 text-sm text-gray-700">
      <p>moto kennt schon eine Person mit diesem Namen und Geburtsdatum:</p>
      <ul className="list-disc space-y-2 pl-5">
        {matches.map((match) =>
          match.kind === "record" ? (
            <li key={`record-${match.recordId}`}>
              Es gibt schon eine Personalakte.{" "}
              <ButtonLink
                href={traegerPath(`${PERSONAL}/${match.recordId}`)}
                variant="link"
                newTab
                tooltip="Öffnet die vorhandene Akte in einem neuen Tab."
              >
                Akte öffnen
              </ButtonLink>
            </li>
          ) : (
            <li key={`school-${match.schoolName}`}>
              An der Schule {match.schoolName} arbeitet die Person schon, noch
              ohne Akte.
            </li>
          ),
        )}
      </ul>
      <p>
        Ist es dieselbe Person? Dann brechen Sie ab. Eine Person ohne Akte
        finden Sie bei den Personalakten unter „Ohne Akte“.
      </p>
      <p>Sind es zwei Personen? Dann stellen Sie die Person trotzdem ein.</p>
    </div>
  );
}

function HiredCard({
  record,
  onRestart,
}: Readonly<{ record: StaffRecordDetail; onRestart: () => void }>) {
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
              href={traegerPath(`${PERSONAL}/${record.id}`)}
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
          message={`Das Soll ist bei ${record.unsyncedSchools.join(", ")} noch nicht angekommen. Speichern Sie später eine Änderung am Vertrag, dann holt moto es nach.`}
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
}: Readonly<{ name: string; incomplete: StaffHireIncomplete }>) {
  const schools = incomplete.schools.join(", ");
  const description = incomplete.recordId
    ? `Die Akte und der Arbeitsvertrag sind gespeichert. moto konnte sie nur nicht noch einmal laden. Bitte öffnen Sie die Akte und prüfen Sie Vertrag und Schulen.`
    : `Es gibt die Person jetzt an: ${schools}. Die Akte fehlt noch. Bitte legen Sie die Akte bei den Personalakten unter „Ohne Akte“ an und tragen Sie dort den Vertrag ein.`;
  return (
    <SectionCard>
      <EmptyState
        tone="error"
        titleAs="h2"
        icon={<WarningIcon aria-hidden className="size-6" />}
        title={`${name} ist nur zum Teil angelegt.`}
        description={`${description} Bitte stellen Sie die Person nicht noch einmal ein.`}
        action={
          incomplete.recordId ? (
            <ButtonLink
              href={traegerPath(`${PERSONAL}/${incomplete.recordId}`)}
              variant="primary"
              size="md"
              tooltip="Öffnet die gespeicherte Akte."
            >
              Akte öffnen
            </ButtonLink>
          ) : (
            <ButtonLink
              href={traegerPath(PERSONAL)}
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
}: Readonly<{ step: number; saving: boolean; onBack: () => void }>) {
  let back: ReactNode;
  if (step === 0) {
    back = (
      <ButtonLink
        href={traegerPath(PERSONAL)}
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
}: Readonly<{ schools: readonly School[]; today: string }>) {
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
      <div ref={stepRef} className="flex flex-col gap-6">
        <IncompleteCard
          name={`${draft.firstName.trim()} ${draft.lastName.trim()}`}
          incomplete={incomplete}
        />
      </div>
    );
  }

  if (hired) {
    return (
      <div ref={stepRef} className="flex flex-col gap-6">
        <HiredCard record={hired} onRestart={restart} />
      </div>
    );
  }

  return (
    <>
      <form
        ref={formRef}
        noValidate
        onSubmit={submit}
        className="flex flex-col gap-6"
      >
        <SectionCard>
          <WizardStepper steps={HIRE_STEPS} current={step} labeled />
        </SectionCard>
        <FormErrorAlert message={errors.error} />
        <div ref={stepRef} className="flex flex-col gap-6">
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
        <StepActions step={step} saving={saving} onBack={back} />
      </form>
      <ConfirmationModal
        isOpen={matches !== null}
        onClose={() => setMatches(null)}
        onConfirm={() => void send(true)}
        title="Gibt es diese Person schon?"
        confirmText="Trotzdem einstellen"
        confirmVariant="warning"
        confirmTooltip="Stellt die Person als neue, zweite Person ein."
        isConfirmLoading={saving}
        loadingText="Stellt ein…"
        isBackdropDismissDisabled
      >
        <DuplicateBody matches={matches ?? []} />
      </ConfirmationModal>
    </>
  );
}
