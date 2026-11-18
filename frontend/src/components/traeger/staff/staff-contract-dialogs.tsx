"use client";

// Die Dialoge der Arbeitsverträge einer Personalakte (#4706): Vertrag
// anlegen, Soll ab einem Tag ändern, Ferien-Soll eintragen und Art oder Ende
// ändern. Jeder Dialog schickt eine Änderung; die Akte kommt danach neu.

import { useId, useState } from "react";
import { Button } from "~/components/ui/button";
import { ChoiceTile } from "~/components/ui/choice-tile";
import { CustomSelect } from "~/components/ui/custom-select";
import { ISODatePicker } from "~/components/ui/date-picker";
import { FieldErrorHint } from "~/components/ui/field-error-hint";
import { FormFieldset } from "~/components/ui/form-fieldset";
import { FormModal } from "~/components/ui/form-modal";
import { InsetPanel } from "~/components/ui/inset-panel";
import { Input } from "~/components/ui/input";
import { Radio } from "~/components/ui/radio";
import { SectionLabel } from "~/components/ui/section-label";
import { SwitchRow } from "~/components/ui/switch";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { formatDate, parseISODate, toISODate } from "~/lib/date-helpers";
import { createLogger } from "~/lib/logger";
import {
  addStaffHolidayWeeks,
  changeStaffContractSoll,
  createStaffContract,
  updateStaffContract,
  type StaffContract,
  type StaffContractKind,
  type StaffContractSiteInput,
  type StaffRecordDetail,
} from "~/lib/traeger-staff-api";
import {
  CONTRACT_KINDS,
  CONTRACT_KIND_HINTS,
  CONTRACT_KIND_LABELS,
  CONTRACT_WEEKDAYS,
  changeableFrom,
  fridayOf,
  hoursFields,
  hoursFieldsEmpty,
  hoursLabel,
  latestSoll,
  mondayOf,
  parseHoursFields,
  weekCount,
  weekMinutes,
} from "./staff-contract-format";

const logger = createLogger({ component: "TraegerStaffContractDialogs" });

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

const HOURS_ERROR = "Bitte je Tag 0 bis 12 Stunden eingeben.";

/** Eine Schule mit ihren Stunden Montag bis Freitag im Formular. */
export interface SiteDraft {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly staffId: string;
  readonly hours: readonly string[];
  /** Was vorher galt, um unveränderte Schulen nicht zu schicken. */
  readonly before: readonly number[] | null;
}

export function WeekHoursRow({
  site,
  index,
  invalid,
  onChange,
}: Readonly<{
  site: SiteDraft;
  index: number;
  invalid: boolean;
  onChange: (hours: readonly string[]) => void;
}>) {
  const minutes = parseHoursFields(site.hours);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium text-gray-900">
          {site.schoolName}
        </span>
        <span className="shrink-0 text-sm text-gray-500 tabular-nums">
          {minutes ? `${hoursLabel(weekMinutes(minutes))} pro Woche` : "–"}
        </span>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {CONTRACT_WEEKDAYS.map((day, dayIndex) => (
          <Input
            key={day.short}
            id={`contract-hours-${index}-${dayIndex}`}
            label={day.short}
            aria-label={`Stunden am ${day.name} an der Schule ${site.schoolName}`}
            aria-invalid={invalid || undefined}
            className="text-center tabular-nums"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={site.hours[dayIndex] ?? ""}
            onChange={(event) =>
              onChange(
                site.hours.map((value, i) =>
                  i === dayIndex ? event.target.value : value,
                ),
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

function SitesFieldset({
  sites,
  error,
  onChange,
}: Readonly<{
  sites: readonly SiteDraft[];
  error: string | undefined;
  onChange: (sites: readonly SiteDraft[]) => void;
}>) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <SectionLabel as="h3">Soll je Schule</SectionLabel>
        <p className="text-sm text-gray-500">
          Stunden pro Tag. Ein leeres Feld ist ein freier Tag.
        </p>
      </div>
      {sites.map((site, index) => (
        <WeekHoursRow
          key={site.schoolId}
          site={site}
          index={index}
          invalid={error !== undefined && parseHoursFields(site.hours) === null}
          onChange={(hours) =>
            onChange(
              sites.map((entry, i) =>
                i === index ? { ...entry, hours } : entry,
              ),
            )
          }
        />
      ))}
      <FieldErrorHint id="contract-sites-error" message={error} />
    </div>
  );
}

/**
 * Die Schulen des Formulars als Eingabe; `null` bei einem falschen Feld. Eine
 * Schule ohne Stunden und ohne bisheriges Soll bleibt draußen. Mit
 * `onlyChanged` gehen nur Schulen mit neuen Stunden mit.
 */
function siteInputs(
  sites: readonly SiteDraft[],
  onlyChanged: boolean,
): StaffContractSiteInput[] | null {
  const inputs: StaffContractSiteInput[] = [];
  for (const site of sites) {
    if (hoursFieldsEmpty(site.hours) && site.before === null) continue;
    const minutes = parseHoursFields(site.hours);
    if (minutes === null) return null;
    const unchanged =
      site.before !== null &&
      minutes.every((value, i) => value === site.before?.[i]);
    if (onlyChanged && unchanged) continue;
    inputs.push({
      schoolId: site.schoolId,
      staffId: site.staffId,
      weekdayMinutes: minutes,
    });
  }
  return inputs;
}

/** Nur die Felder mit einem Hinweis, für `invalid`. */
function fieldErrors(
  fields: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function DialogFooter({
  saving,
  onCancel,
  onSave,
  saveLabel,
  saveTooltip,
}: Readonly<{
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
  saveLabel: string;
  saveTooltip: string;
}>) {
  return (
    <div className="flex justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="md"
        onClick={onCancel}
        disabled={saving}
        noTooltip="Abbrechen schließt den Dialog, ohne etwas zu ändern."
      >
        Abbrechen
      </Button>
      <Button
        type="button"
        variant="primary"
        size="md"
        onClick={onSave}
        isLoading={saving}
        loadingText="Speichert…"
        tooltip={saveTooltip}
      >
        {saveLabel}
      </Button>
    </div>
  );
}

export function KindChoice({
  value,
  onChange,
}: Readonly<{
  value: StaffContractKind;
  onChange: (kind: StaffContractKind) => void;
}>) {
  const name = useId();
  return (
    <FormFieldset
      legend="Art des Vertrags"
      hint="Jede Art rechnet der Lohnexport mit eigenen Lohnarten ab."
    >
      <div className="grid gap-2 sm:grid-cols-3">
        {CONTRACT_KINDS.map((kind) => {
          const id = `${name}-${kind}`;
          const selected = value === kind;
          return (
            <ChoiceTile
              key={kind}
              htmlFor={id}
              selected={selected}
              className="items-start py-3"
            >
              <Radio
                id={id}
                name={name}
                value={kind}
                checked={selected}
                onChange={() => onChange(kind)}
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">
                  {CONTRACT_KIND_LABELS[kind]}
                </span>
                <span className="mt-0.5 block text-xs leading-5 font-normal text-gray-500">
                  {CONTRACT_KIND_HINTS[kind]}
                </span>
              </span>
            </ChoiceTile>
          );
        })}
      </div>
    </FormFieldset>
  );
}

/** Ein Dialog, der eine Änderung schickt und die neue Akte meldet. */
function useContractSave(open: boolean, object: string) {
  const save = useFormModalPending(open);
  const errors = useApiFormError();
  const { success } = useToast();
  const run = async (
    send: () => Promise<StaffRecordDetail>,
    done: string,
    onSaved: (record: StaffRecordDetail) => void,
  ) => {
    await save.run(async (op) => {
      errors.clear();
      try {
        const record = await send();
        success(done);
        if (op.isCurrent()) onSaved(record);
      } catch (err) {
        logger.error("traeger_staff_contract_save_failed", {
          error: errorMessage(err),
        });
        if (op.isCurrent()) await errors.show(err, { object });
      }
    });
  };
  return { save, errors, run };
}

type DialogProps = Readonly<{
  record: StaffRecordDetail;
  onClose: () => void;
  onSaved: (record: StaffRecordDetail) => void;
}>;

/**
 * Das Merkmal „Vertretungspool“ (#4709): die Person ist Springer, und jede
 * Schule des Trägers kann sie blocken.
 */
function PoolSwitch({
  checked,
  onChange,
}: Readonly<{ checked: boolean; onChange: (pool: boolean) => void }>) {
  return (
    <SwitchRow
      label="Vertretungspool"
      description="Die Person springt an allen Ihren Schulen ein. Jede Schule sieht sie und kann sie blocken."
      checked={checked}
      onCheckedChange={onChange}
    />
  );
}

/** Arbeitsvertrag anlegen: Art, Laufzeit und das erste Soll je Schule. */
export function CreateContractDialog({
  record,
  onClose,
  onSaved,
}: DialogProps) {
  const [kind, setKind] = useState<StaffContractKind>("part_time");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [pool, setPool] = useState(false);
  const [sites, setSites] = useState<readonly SiteDraft[]>(() =>
    record.employments
      .filter((employment) => employment.active)
      .map((employment) => ({
        schoolId: employment.schoolId,
        schoolName: employment.schoolName,
        staffId: employment.staffId,
        hours: hoursFields(null),
        before: null,
      })),
  );
  const { save, errors, run } = useContractSave(true, "den Arbeitsvertrag");

  const submit = () => {
    const inputs = siteInputs(sites, false);
    const fields = {
      starts_on: startsOn ? undefined : "Bitte den ersten Tag wählen.",
      ends_on:
        endsOn && startsOn && endsOn < startsOn
          ? "Der letzte Tag liegt vor dem ersten Tag."
          : undefined,
      sites:
        inputs === null
          ? HOURS_ERROR
          : inputs.length === 0
            ? "Tragen Sie für mindestens eine Schule Stunden ein."
            : undefined,
    };
    if (inputs === null || fields.starts_on || fields.ends_on || fields.sites) {
      errors.invalid(
        "Bitte prüfen Sie die markierten Felder.",
        fieldErrors(fields),
      );
      return;
    }
    void run(
      () =>
        createStaffContract(record.id, {
          kind,
          startsOn,
          endsOn: endsOn || null,
          pool,
          sites: inputs,
        }),
      "Der Arbeitsvertrag ist angelegt. Die Schulen rechnen mit dem neuen Soll.",
      onSaved,
    );
  };

  return (
    <FormModal
      isOpen
      onClose={onClose}
      title="Arbeitsvertrag anlegen"
      size="lg"
      pending={save}
      isBackdropDismissDisabled
      error={errors.error}
      footer={
        <DialogFooter
          saving={save.pending}
          onCancel={onClose}
          onSave={submit}
          saveLabel="Vertrag anlegen"
          saveTooltip="Legt den Vertrag an. Die Schulen rechnen danach mit diesem Soll."
        />
      }
    >
      <div className="space-y-5">
        <KindChoice value={kind} onChange={setKind} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ISODatePicker
            id="contract-starts-on"
            monthYearNavigation
            label="Erster Tag"
            error={errors.fieldError("starts_on")}
            value={startsOn}
            onChange={setStartsOn}
            calendarLayout="popover"
          />
          <ISODatePicker
            id="contract-ends-on"
            monthYearNavigation
            label="Letzter Tag"
            hint="Leer lassen, wenn der Vertrag unbefristet ist."
            error={errors.fieldError("ends_on")}
            value={endsOn}
            min={startsOn || undefined}
            defaultMonth={startsOn || undefined}
            onChange={setEndsOn}
            calendarLayout="popover"
          />
        </div>
        <SitesFieldset
          sites={sites}
          error={errors.fieldError("sites")}
          onChange={setSites}
        />
        <PoolSwitch checked={pool} onChange={setPool} />
        <InsetPanel padding="sm">
          <p className="text-sm text-gray-600">
            Die Schulen rechnen ab dem laufenden Monat mit diesem Soll.
            Abgeschlossene Monate bleiben, wie sie sind.
          </p>
        </InsetPanel>
      </div>
    </FormModal>
  );
}

/** Der Erste des nächsten Monats, der Vorschlag für „Gilt ab“. */
function firstOfNextMonth(day: string): string {
  const date = parseISODate(day);
  return toISODate(new Date(date.getFullYear(), date.getMonth() + 1, 1));
}

/** Soll ab einem Tag ändern, für eine oder mehrere Schulen. */
export function ChangeSollDialog({
  record,
  contract,
  today,
  onClose,
  onSaved,
}: DialogProps & Readonly<{ contract: StaffContract; today: string }>) {
  const earliest = changeableFrom(contract.sites);
  const [validFrom, setValidFrom] = useState(() => {
    const proposal = firstOfNextMonth(today);
    return proposal < earliest ? earliest : proposal;
  });
  const [sites, setSites] = useState<readonly SiteDraft[]>(() => {
    const inContract = contract.sites.map((site) => {
      const current = latestSoll(site);
      return {
        schoolId: site.schoolId,
        schoolName: site.schoolName,
        staffId: site.staffId,
        hours: hoursFields(current?.weekdayMinutes ?? null),
        before: current?.weekdayMinutes ?? null,
      };
    });
    const joining = record.employments
      .filter(
        (employment) =>
          employment.active &&
          !contract.sites.some((site) => site.schoolId === employment.schoolId),
      )
      .map((employment) => ({
        schoolId: employment.schoolId,
        schoolName: employment.schoolName,
        staffId: employment.staffId,
        hours: hoursFields(null),
        before: null,
      }));
    return [...inContract, ...joining];
  });
  const { save, errors, run } = useContractSave(true, "das Soll");

  const submit = () => {
    const inputs = siteInputs(sites, true);
    const fields = {
      valid_from: validFrom ? undefined : "Bitte den ersten Tag wählen.",
      sites:
        inputs === null
          ? HOURS_ERROR
          : inputs.length === 0
            ? "Ändern Sie die Stunden mindestens einer Schule."
            : undefined,
    };
    if (inputs === null || fields.valid_from || fields.sites) {
      errors.invalid(
        "Bitte prüfen Sie die markierten Felder.",
        fieldErrors(fields),
      );
      return;
    }
    void run(
      () => changeStaffContractSoll(record.id, contract.id, validFrom, inputs),
      `Das neue Soll gilt ab dem ${formatDate(validFrom)}.`,
      onSaved,
    );
  };

  return (
    <FormModal
      isOpen
      onClose={onClose}
      title="Soll ändern"
      size="lg"
      pending={save}
      isBackdropDismissDisabled
      error={errors.error}
      footer={
        <DialogFooter
          saving={save.pending}
          onCancel={onClose}
          onSave={submit}
          saveLabel="Soll speichern"
          saveTooltip="Speichert das neue Soll. Die Schulen rechnen ab dem gewählten Tag damit."
        />
      }
    >
      <div className="space-y-5">
        <ISODatePicker
          id="contract-soll-valid-from"
          monthYearNavigation
          label="Gilt ab"
          hint={
            earliest
              ? `Frühestens ab dem ${formatDate(earliest)}. Davor haben die Schulen schon gerechnet.`
              : undefined
          }
          error={errors.fieldError("valid_from")}
          value={validFrom}
          min={earliest || undefined}
          onChange={setValidFrom}
          calendarLayout="popover"
        />
        <SitesFieldset
          sites={sites}
          error={errors.fieldError("sites")}
          onChange={setSites}
        />
      </div>
    </FormModal>
  );
}

/** Ferien-Soll für eine oder mehrere Wochen an einer Schule. */
export function HolidayWeeksDialog({
  record,
  contract,
  onClose,
  onSaved,
}: DialogProps & Readonly<{ contract: StaffContract }>) {
  const [schoolId, setSchoolId] = useState(contract.sites[0]?.schoolId ?? "");
  const site = contract.sites.find((entry) => entry.schoolId === schoolId);
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  const [hours, setHours] = useState<readonly string[]>(() =>
    hoursFields(
      contract.sites[0]
        ? (latestSoll(contract.sites[0])?.weekdayMinutes ?? null)
        : null,
    ),
  );
  const { save, errors, run } = useContractSave(true, "das Ferien-Soll");

  const fromWeek = fromDay ? mondayOf(fromDay) : "";
  const toWeek = toDay ? mondayOf(toDay) : fromWeek;
  const weeks =
    fromWeek && toWeek >= fromWeek ? weekCount(fromWeek, toWeek) : 0;
  const minutes = parseHoursFields(hours);
  const earliest = site?.changeableFrom;

  const submit = () => {
    const fields = {
      from_week: fromWeek ? undefined : "Bitte die erste Woche wählen.",
      to_week:
        fromWeek && toWeek < fromWeek
          ? "Die letzte Woche liegt vor der ersten."
          : undefined,
      weekday_minutes: minutes === null ? HOURS_ERROR : undefined,
    };
    if (!site || minutes === null || fields.from_week || fields.to_week) {
      errors.invalid(
        "Bitte prüfen Sie die markierten Felder.",
        fieldErrors(fields),
      );
      return;
    }
    void run(
      () =>
        addStaffHolidayWeeks(record.id, contract.id, {
          schoolId: site.schoolId,
          staffId: site.staffId,
          fromWeek,
          toWeek,
          weekdayMinutes: minutes,
        }),
      weeks === 1
        ? "Das Ferien-Soll für die Woche ist eingetragen."
        : `Das Ferien-Soll für ${weeks} Wochen ist eingetragen.`,
      onSaved,
    );
  };

  return (
    <FormModal
      isOpen
      onClose={onClose}
      title="Ferien-Soll eintragen"
      size="md"
      pending={save}
      isBackdropDismissDisabled
      error={errors.error}
      footer={
        <DialogFooter
          saving={save.pending}
          onCancel={onClose}
          onSave={submit}
          saveLabel="Eintragen"
          saveTooltip="Trägt das Soll für diese Wochen ein. Die Schule rechnet dann damit."
        />
      }
    >
      <div className="space-y-5">
        {contract.sites.length > 1 ? (
          <CustomSelect
            id="holiday-week-school"
            label="Schule"
            value={schoolId}
            options={contract.sites.map((entry) => ({
              value: entry.schoolId,
              label: entry.schoolName,
            }))}
            onChange={(value) => {
              setSchoolId(value);
              const next = contract.sites.find(
                (entry) => entry.schoolId === value,
              );
              setHours(
                hoursFields(
                  next ? (latestSoll(next)?.weekdayMinutes ?? null) : null,
                ),
              );
            }}
          />
        ) : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ISODatePicker
            id="holiday-week-from"
            monthYearNavigation
            label="Erste Woche"
            hint="Ein Tag reicht, es zählt die ganze Woche."
            error={errors.fieldError("from_week")}
            value={fromDay}
            min={earliest || undefined}
            onChange={setFromDay}
            calendarLayout="popover"
          />
          <ISODatePicker
            id="holiday-week-to"
            monthYearNavigation
            label="Letzte Woche"
            hint="Leer lassen für eine Woche."
            error={errors.fieldError("to_week")}
            value={toDay}
            min={fromDay || earliest || undefined}
            defaultMonth={fromDay || undefined}
            onChange={setToDay}
            calendarLayout="popover"
          />
        </div>
        {weeks > 0 ? (
          <InsetPanel padding="sm">
            <p className="text-sm text-gray-700">
              {weeks === 1 ? "1 Woche" : `${weeks} Wochen`}: Montag,{" "}
              {formatDate(fromWeek)} bis Freitag, {formatDate(fridayOf(toWeek))}
            </p>
          </InsetPanel>
        ) : null}
        <SitesFieldset
          sites={[
            {
              schoolId: schoolId || "site",
              schoolName: "Soll in diesen Wochen",
              staffId: site?.staffId ?? "",
              hours,
              before: null,
            },
          ]}
          error={errors.fieldError("weekday_minutes")}
          onChange={(next) => setHours(next[0]?.hours ?? hours)}
        />
        <p className="text-sm text-gray-500">
          Feiertage bleiben frei. Wochen ohne Eintrag zählen mit dem normalen
          Soll.
        </p>
      </div>
    </FormModal>
  );
}

/** Art und letzten Tag eines Vertrags ändern. */
export function ContractTermsDialog({
  record,
  contract,
  onClose,
  onSaved,
}: DialogProps & Readonly<{ contract: StaffContract }>) {
  const [kind, setKind] = useState<StaffContractKind>(contract.kind);
  const [endsOn, setEndsOn] = useState(contract.endsOn ?? "");
  const [pool, setPool] = useState(contract.pool);
  const earliest = changeableFrom(contract.sites);
  const { save, errors, run } = useContractSave(true, "den Arbeitsvertrag");

  const submit = () => {
    if (endsOn && endsOn < contract.startsOn) {
      errors.invalid("Bitte prüfen Sie die markierten Felder.", {
        ends_on: "Der letzte Tag liegt vor dem ersten Tag.",
      });
      return;
    }
    void run(
      () =>
        updateStaffContract(record.id, contract.id, {
          kind,
          endsOn: endsOn || null,
          pool,
        }),
      "Der Arbeitsvertrag ist gespeichert.",
      onSaved,
    );
  };

  return (
    <FormModal
      isOpen
      onClose={onClose}
      title="Vertrag ändern"
      size="md"
      pending={save}
      isBackdropDismissDisabled
      error={errors.error}
      footer={
        <DialogFooter
          saving={save.pending}
          onCancel={onClose}
          onSave={submit}
          saveLabel="Speichern"
          saveTooltip="Speichert Art, Ende und Vertretungspool. Nach dem letzten Tag zählt kein Soll mehr."
        />
      }
    >
      <div className="space-y-5">
        <KindChoice value={kind} onChange={setKind} />
        <ISODatePicker
          id="contract-terms-ends-on"
          monthYearNavigation
          label="Letzter Tag"
          hint={`Leer lassen, wenn der Vertrag unbefristet ist.${
            earliest
              ? ` Frühestens am ${formatDate(previousDay(earliest))}.`
              : ""
          }`}
          error={errors.fieldError("ends_on")}
          value={endsOn}
          min={earliest ? previousDay(earliest) : contract.startsOn}
          onChange={setEndsOn}
          calendarLayout="popover"
        />
        <p className="text-sm text-gray-500">
          Nach dem letzten Tag zählt an den Schulen kein Soll mehr. Ferienwochen
          danach fallen weg.
        </p>
        <PoolSwitch checked={pool} onChange={setPool} />
      </div>
    </FormModal>
  );
}

function previousDay(day: string): string {
  const date = parseISODate(day);
  date.setDate(date.getDate() - 1);
  return toISODate(date);
}
