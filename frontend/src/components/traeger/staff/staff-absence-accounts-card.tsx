"use client";

// Die Kontingente einer Personalakte (#4710): je Abwesenheitsart des Trägers
// ein Konto über alle Schulen der Person, mit dem, was jede Schule gebucht
// hat. Die Personalverwaltung ändert hier den Anspruch dieser Person; ohne
// eigenen Wert gilt der Standard der Art. Jedes Laden steht im
// Zugriffsprotokoll jeder Schule der Person.

import { useLayoutEffect, useRef, useState } from "react";

import { AllowanceCard } from "~/components/staff/allowance-card";
import { useFreshTraegerResource } from "~/components/traeger/use-traeger-resource";
import { ButtonLink } from "~/components/ui/button";
import { EditActions } from "~/components/ui/edit-actions";
import { EmptyState } from "~/components/ui/empty-state";
import { FieldLabel } from "~/components/ui/field-label";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { Input } from "~/components/ui/input";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { NumberStepper } from "~/components/ui/number-stepper";
import { ProgressBar } from "~/components/ui/progress-bar";
import { SectionCard } from "~/components/ui/section-card";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { formatDayCount } from "~/lib/absence-helpers";
import { timeTrackingConcept } from "~/lib/concepts/timeTracking";
import { formatDate } from "~/lib/date-helpers";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { createLogger } from "~/lib/logger";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerStaffKeys } from "~/lib/swr/traeger-staff-keys";
import {
  fetchTraegerAbsenceAccounts,
  setTraegerAbsenceAllowance,
  type TraegerAbsenceAccount,
  type TraegerAbsenceSchoolUse,
} from "~/lib/traeger-absence-api";
import { traegerPath } from "~/lib/traeger-url";

const logger = createLogger({ component: "TraegerStaffAbsenceAccounts" });

const MAX_DAYS = 366;

function parseDays(raw: string): number | null {
  const value = Number(raw.trim().replace(",", "."));
  if (raw.trim() === "" || !Number.isFinite(value)) return null;
  if (value < 0 || value > MAX_DAYS || !Number.isInteger(value * 2)) {
    return null;
  }
  return value;
}

const formatInput = (days: number) => String(days).replace(".", ",");

/** Eine Zeile je Schule: was dort gebucht ist und wie die Schule abweicht. */
function schoolLine(school: TraegerAbsenceSchoolUse): string {
  const parts = [`${formatDayCount(school.takenDays)} genommen`];
  if (school.reservedDays > 0) {
    parts.push(`${formatDayCount(school.reservedDays)} beantragt`);
  }
  if (!school.offered) parts.push("an dieser Schule nicht angeboten");
  else if (school.limitDays !== null) {
    parts.push(`hier höchstens ${formatDayCount(school.limitDays)}`);
  }
  return parts.join(" · ");
}

function SchoolShares({
  account,
}: Readonly<{ account: TraegerAbsenceAccount }>) {
  const used = account.takenDays + account.reservedDays;
  return (
    <div className="space-y-3">
      <ProgressBar
        size="sm"
        value={used}
        max={Math.max(account.entitledDays, used)}
        tone={account.remainingDays <= 0 ? "orange" : "green"}
        label={`${formatDayCount(used)} von ${formatDayCount(account.entitledDays)} genutzt oder beantragt`}
      />
      {account.schools.length > 0 ? (
        <ul className="space-y-1 border-t border-gray-100 pt-3 text-xs">
          {account.schools.map((school) => (
            <li
              key={school.schoolId}
              className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4"
            >
              <span className="font-medium text-gray-700">
                {school.schoolName}
              </span>
              <span className="text-gray-600 tabular-nums">
                {schoolLine(school)}
              </span>
            </li>
          ))}
          {account.expiredDays > 0 ? (
            <li className="text-moto-red-strong">
              {formatDayCount(account.expiredDays)} am{" "}
              {formatDate(account.expiresOn)} verfallen
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function AllowanceForm({
  recordId,
  account,
  onCancel,
  onSaved,
}: Readonly<{
  recordId: string;
  account: TraegerAbsenceAccount;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}>) {
  const [days, setDays] = useState(formatInput(account.entitledDays));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const errors = useApiFormError();
  const { success } = useToast();
  const latestSaveRef = useRef<() => Promise<void>>(async () => undefined);
  const used = account.takenDays + account.reservedDays;
  const parsed = parseDays(days);
  const id = `traeger-allowance-${account.absenceTypeId}`;

  const save = async () => {
    errors.clear();
    const daysError =
      parsed === null
        ? "Bitte ganze oder halbe Tage zwischen 0 und 366 eintragen."
        : parsed < used
          ? `Mindestens ${formatDayCount(used)}. So viele sind an allen Schulen schon eingetragen oder beantragt.`
          : undefined;
    const reasonError =
      reason.trim() === ""
        ? "Bitte kurz sagen, warum sich der Anspruch ändert."
        : undefined;
    if (daysError || reasonError || parsed === null) {
      errors.invalid("Bitte prüfe die markierten Felder.", {
        ...(daysError ? { entitled_days: daysError } : {}),
        ...(reasonError ? { reason: reasonError } : {}),
      });
      return;
    }
    setSaving(true);
    try {
      await setTraegerAbsenceAllowance(recordId, account.absenceTypeId, {
        year: account.year,
        entitledDays: parsed,
        reason,
      });
      success(
        `Der Anspruch ${account.absenceTypeName} ${account.year} ist gespeichert. Er gilt an allen Schulen der Person.`,
      );
    } catch (err) {
      logger.error("traeger_absence_allowance_save_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      await errors.show(err, {
        object: "die Änderung am Anspruch",
        retry: () => void latestSaveRef.current(),
      });
      setSaving(false);
      return;
    }
    setSaving(false);
    await onSaved();
  };

  useLayoutEffect(() => {
    latestSaveRef.current = save;
  });

  return (
    <form
      className="space-y-4"
      noValidate
      aria-label={`Anspruch ${account.absenceTypeName} ${account.year}`}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <FormErrorAlert message={errors.error} />
      <div>
        <FieldLabel htmlFor={`${id}-days`}>
          Anspruch {account.year} in Tagen
        </FieldLabel>
        <NumberStepper
          id={`${id}-days`}
          name="entitled_days"
          inputMode="decimal"
          value={days}
          onChange={(event) => setDays(event.target.value)}
          onStep={(delta) =>
            setDays(
              formatInput(
                Math.min(MAX_DAYS, Math.max(used, (parsed ?? 0) + delta)),
              ),
            )
          }
          canDecrement={(parsed ?? 0) - 1 >= used}
          canIncrement={(parsed ?? 0) + 1 <= MAX_DAYS}
          decrementLabel="Einen Tag weniger"
          incrementLabel="Einen Tag mehr"
          error={errors.fieldError("entitled_days")}
          disabled={saving}
        />
        <p className="mt-1 text-xs text-gray-500">
          Gilt nur für diese Person und dieses Jahr. Der Standard der Art ist{" "}
          {formatDayCount(account.standardDays)}.
        </p>
      </div>
      <Input
        id={`${id}-reason`}
        name="reason"
        label="Begründung"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="z. B. Vereinbarung im Arbeitsvertrag"
        error={errors.fieldError("reason")}
        disabled={saving}
      />
      <EditActions
        onCancel={onCancel}
        saving={saving}
        saveTooltip="Speichert den Anspruch. Er gilt sofort an allen Schulen der Person."
      />
    </form>
  );
}

export function StaffAbsenceAccountsCard({
  recordId,
}: Readonly<{ recordId: string }>) {
  const today = useBerlinToday();
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const { data: accounts, error } = useFreshTraegerResource(
    traegerStaffKeys.absenceAccounts(recordId, year),
    () => fetchTraegerAbsenceAccounts(recordId, year),
    "die Kontingente",
  );
  const [editing, setEditing] = useState<string | null>(null);
  const invalidateFamily = useInvalidateFamily();

  return (
    <SectionCard
      concept={timeTrackingConcept}
      title="Kontingente"
      description="Tage je Abwesenheitsart über alle Schulen der Person. Jede Buchung und jeder offene Antrag an jeder Schule zählt hier mit."
      action={
        <SegmentedControl
          ariaLabel="Jahr der Kontingente"
          value={String(year)}
          onChange={(next) => {
            setEditing(null);
            setYear(Number(next));
          }}
          items={[thisYear, thisYear + 1].map((value) => ({
            value: String(value),
            label: String(value),
          }))}
        />
      }
      loading={accounts === null && !error}
    >
      {error ? (
        <LoadErrorAlert error={error} actionLayout="responsive" />
      ) : accounts && accounts.length === 0 ? (
        <EmptyState
          variant="compact"
          title="Keine Abwesenheitsart mit Kontingent."
          description="Lege unter Abwesenheitsarten eine Art mit Kontingent an, zum Beispiel Regenerationstag."
          action={
            <ButtonLink
              href={traegerPath("/traeger/personal/abwesenheitsarten")}
              variant="outline"
              size="md"
              tooltip="Öffnet die Abwesenheitsarten deines Trägers."
            >
              Zu den Abwesenheitsarten
            </ButtonLink>
          }
        />
      ) : accounts ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {accounts.map((account) => (
            <AllowanceCard
              key={account.absenceTypeId}
              headingLevel={3}
              title={account.absenceTypeName}
              year={account.year}
              entitled={account.entitledDays}
              entitledHint={
                account.individual ? "für diese Person" : "Standard der Art"
              }
              taken={account.takenDays}
              takenHint={
                account.carriedIn && account.carriedIn.remainingDays > 0
                  ? `+ ${formatDayCount(account.carriedIn.remainingDays)} Rest aus ${account.carriedIn.year} bis ${formatDate(account.carriedIn.expiresOn)}`
                  : undefined
              }
              reserved={account.reservedDays}
              remaining={account.remainingDays}
              onEdit={() => setEditing(account.absenceTypeId)}
              editForm={
                editing === account.absenceTypeId ? (
                  <AllowanceForm
                    recordId={recordId}
                    account={account}
                    onCancel={() => setEditing(null)}
                    onSaved={async () => {
                      setEditing(null);
                      // Der Anspruch eines Jahres ändert den Rest im
                      // Folgejahr.
                      await invalidateFamily(
                        traegerStaffKeys.absenceAccountsFamily,
                      );
                    }}
                  />
                ) : undefined
              }
              footer={<SchoolShares account={account} />}
            />
          ))}
        </div>
      ) : null}
    </SectionCard>
  );
}
