"use client";

// Die Kontingente einer Personalakte (#4710): je Abwesenheitsart des Trägers
// ein Konto über alle Schulen der Person, mit dem, was jede Schule gebucht
// hat. Die Personalverwaltung ändert hier den Anspruch dieser Person; ohne
// eigenen Wert gilt der Standard der Art. Jedes Laden steht im
// Zugriffsprotokoll jeder Schule der Person, deshalb liest die Karte bei
// jedem Öffnen neu. Das Speichern trägt die Version des gelesenen Anspruchs
// (ADR 0311).

import { useLayoutEffect, useRef, useState } from "react";

import { AllowanceCard } from "~/components/staff/allowance-card";
import { useFreshTraegerResource } from "~/components/traeger/use-traeger-resource";
import { useDraftOn } from "~/lib/swr/read-draft";
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
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
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

interface AllowanceDraft {
  readonly days: string;
  readonly reason: string;
}

/** The values a stored claim fills the allowance form with. */
function allowanceDraft(account: TraegerAbsenceAccount): AllowanceDraft {
  return { days: formatInput(account.entitledDays), reason: "" };
}

function AllowanceForm({
  recordId,
  account,
  reload,
  onCancel,
  onSaved,
}: Readonly<{
  recordId: string;
  account: TraegerAbsenceAccount;
  /** Reads the claim again; rejects when the read fails (ADR 0311). */
  reload: () => Promise<TraegerAbsenceAccount>;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}>) {
  // The claim the form opened from (ADR 0311): its version goes out with
  // the save. A newer read refills the form only while untouched; after a
  // refusal the stored claim shows, and nothing is sent until it is read.
  const edit = useDraftOn<
    TraegerAbsenceAccount,
    AllowanceDraft,
    string,
    unknown
  >(
    {
      opening: `${account.absenceTypeId}:${account.year}`,
      data: account,
      reload,
    },
    {
      token: (claim) => claim.version,
      toDraft: allowanceDraft,
      // The reason annotates the change; it stays over the stored claim.
      rebase: (draft, _from, stored) => ({
        ...allowanceDraft(stored),
        reason: draft.reason,
      }),
    },
  );
  const { days, reason } = edit.draft ?? allowanceDraft(account);
  const setDays = (value: string) =>
    edit.setDraft((current) => ({ ...current, days: value }));
  const setReason = (value: string) =>
    edit.setDraft((current) => ({ ...current, reason: value }));
  const [saving, setSaving] = useState(false);
  const errors = useApiFormError();
  const { success } = useToast();
  const latestSaveRef = useRef<() => Promise<void>>(async () => undefined);
  const used = account.takenDays + account.reservedDays;
  const parsed = parseDays(days);
  const id = `traeger-allowance-${account.absenceTypeId}`;

  const save = async () => {
    // Enter submits too: nothing goes out before the stored claim is read.
    if (!edit.canSubmit) return;
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
    const result = await edit.submit((version, sent) =>
      setTraegerAbsenceAllowance(recordId, account.absenceTypeId, {
        year: account.year,
        entitledDays: parsed,
        reason: sent.reason,
        expectedVersion: version,
      }),
    );
    setSaving(false);
    if (!result.ok) {
      logger.error("traeger_absence_allowance_save_failed", {
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      // Changed since the read: `reload` shows the stored claim again,
      // without a retry of the same version.
      await errors.show(result.error, {
        object: "die Änderung am Anspruch",
        retry: () => void latestSaveRef.current(),
        reload: result.reload,
      });
      return;
    }
    success(
      `Der Anspruch ${account.absenceTypeName} ${account.year} ist gespeichert. Er gilt an allen Schulen der Person.`,
    );
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
        controlSize="compact"
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
        disabled={!edit.canSubmit}
        disabledReason={
          edit.status === "loadFailed"
            ? "Lade zuerst den gespeicherten Stand neu."
            : "Der gespeicherte Stand wird geladen."
        }
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
  const {
    data: accounts,
    error,
    reloadOrThrow,
  } = useFreshTraegerResource(
    traegerStaffKeys.absenceAccounts(recordId, year),
    () => fetchTraegerAbsenceAccounts(recordId, year),
    "die Kontingente",
  );
  const [editing, setEditing] = useState<string | null>(null);
  const invalidateFamily = useInvalidateFamily();
  // A saved claim whose read failed: the card says it is saved and that
  // the figures may be old; „Wiederholen“ reads again (ADR 0311 rule 6).
  const afterSave = useRefreshAfterWrite("die Kontingente", reloadOrThrow);
  const readFailed = useRef(false);

  return (
    <SectionCard
      concept={timeTrackingConcept}
      title="Kontingente"
      description="Tage pro Abwesenheitsart über alle Schulen der Person. Jede Buchung und jeder offene Antrag an jeder Schule zählt hier mit."
      action={
        <SegmentedControl
          ariaLabel="Jahr der Kontingente"
          value={String(year)}
          onChange={(next) => {
            setEditing(null);
            afterSave.clear();
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
          {afterSave.error ? (
            <LoadErrorAlert
              error={afterSave.error}
              actionLayout="responsive"
              className="lg:col-span-2"
            />
          ) : null}
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
                    // Liest die Kontingente neu (ein Eintrag im
                    // Zugriffsprotokoll) und lehnt ab, wenn das scheitert.
                    reload={async () => {
                      readFailed.current = true;
                      const stored = (await reloadOrThrow()).find(
                        (entry) =>
                          entry.absenceTypeId === account.absenceTypeId,
                      );
                      if (!stored) throw new Error("account is gone");
                      readFailed.current = false;
                      return stored;
                    }}
                    onCancel={() => setEditing(null)}
                    onSaved={async () => {
                      setEditing(null);
                      // The form read the stored claim after the save; a
                      // failure would leave the old figures unexplained.
                      if (readFailed.current) void afterSave.refresh();
                      else afterSave.clear();
                      // Den gespeicherten Stand hat das Formular schon
                      // gelesen; der Anspruch eines Jahres ändert den Rest
                      // im Folgejahr.
                      await invalidateFamily(
                        traegerStaffKeys.absenceAccounts(
                          recordId,
                          account.year + 1,
                        ),
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
