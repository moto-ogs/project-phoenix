"use client";

// Das Stundenkonto einer Personalakte (#4711, ADR 0243): Soll, Ist und Saldo
// eines Monats über alle Schulen der Person, je Schule eine Zeile. Mit einem
// Arbeitsvertrag beim Träger schließt die Personalverwaltung den Monat hier
// ab, in jeder Schule, die der Vertrag abdeckt, und nur sie öffnet ihn
// wieder. Jedes Laden steht im Zugriffsprotokoll jeder Schule der Person.

import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Lock, LockOpen } from "lucide-react";

import { MonthCloseReasonModal } from "~/components/staff/month-close-modal";
import { useFreshTraegerResource } from "~/components/traeger/use-traeger-resource";
import { useDraftOn } from "~/lib/swr/read-draft";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { SectionCard } from "~/components/ui/section-card";
import { StatCard } from "~/components/ui/stat-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { timeTrackingConcept } from "~/lib/concepts/timeTracking";
import { formatBerlinDate } from "~/lib/date-helpers";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import {
  formatDuration,
  formatSignedDuration,
  monthLabel,
} from "~/lib/duration-format";
import { traegerStaffKeys } from "~/lib/swr/traeger-staff-keys";
import {
  closeTraegerTimeAccountMonth,
  fetchTraegerTimeAccount,
  reopenTraegerTimeAccountMonth,
  type TraegerTimeAccount,
  type TraegerTimeAccountSchool,
} from "~/lib/traeger-time-account-api";

interface MonthKey {
  readonly year: number;
  readonly month: number;
}

const monthKeyLabel = ({ year, month }: MonthKey) => monthLabel(year, month);

/** „2026-11“ als „November 2026“. */
const isoMonthLabel = (value: string) => {
  const [year, month] = value.split("-").map(Number);
  return year && month ? monthLabel(year, month) : value;
};

const shift = ({ year, month }: MonthKey, delta: number): MonthKey => {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};

const saldoTone = (minutes: number) =>
  minutes > 0 ? "green" : minutes < 0 ? "red" : "neutral";

const saldoText = (minutes: number) =>
  minutes > 0
    ? "text-moto-green-strong"
    : minutes < 0
      ? "text-moto-red-strong"
      : "text-gray-700";

/** Wie der Monat an einer Schule steht, in Worten der Schule. */
function SchoolMonthBadge({
  school,
}: Readonly<{ school: TraegerTimeAccountSchool }>) {
  if (school.closedByTraeger) {
    return (
      <StatusBadge
        label="Vom Träger abgeschlossen"
        tone="gray"
        icon={Lock}
        compact
      />
    );
  }
  if (school.closed) {
    return (
      <StatusBadge
        label="Von der Schule abgeschlossen"
        tone="gray"
        icon={Lock}
        compact
      />
    );
  }
  if (school.byTraeger) {
    return <StatusBadge label="Offen" tone="warning" compact />;
  }
  return (
    <StatusBadge label="Schule schließt selbst ab" tone="outline" compact />
  );
}

const STATE_BADGE = {
  open: { label: "Offen", tone: "warning" },
  closed: { label: "Abgeschlossen", tone: "green" },
  school: { label: "Schulen schließen selbst ab", tone: "outline" },
} as const;

/** Was den Abschluss gerade aufhält, in einem Satz; null, wenn nichts. */
function closeBlocker(account: TraegerTimeAccount): string | null {
  if (account.state !== "open") return null;
  if (!account.ended) {
    return "Abschließen geht ab dem 1. des Folgemonats.";
  }
  const later = account.schools.find(
    (school) => school.byTraeger && school.laterClosed,
  );
  if (later?.laterClosed) {
    return `An der Schule ${later.schoolName} ist ${isoMonthLabel(later.laterClosed)} schon abgeschlossen. Öffne zuerst diesen Monat.`;
  }
  return null;
}

function reopenBlocker(account: TraegerTimeAccount): string | null {
  const later = account.schools.find(
    (school) => school.closedByTraeger && school.laterClosed,
  );
  return later?.laterClosed
    ? `Öffne zuerst ${isoMonthLabel(later.laterClosed)}. Monate öffnest du vom neuesten an.`
    : null;
}

export function StaffTimeAccountCard({
  recordId,
}: Readonly<{ recordId: string }>) {
  const today = useBerlinToday();
  const thisMonth = useMemo<MonthKey>(
    () => ({
      year: Number(today.slice(0, 4)),
      month: Number(today.slice(5, 7)),
    }),
    [today],
  );
  // Abgeschlossen wird der Vormonat: dort beginnt die Karte.
  const [shown, setShown] = useState<MonthKey>(() => shift(thisMonth, -1));
  const {
    data: account,
    error,
    mutate,
    reload,
    reloadOrThrow,
  } = useFreshTraegerResource(
    traegerStaffKeys.timeAccount(recordId, shown.year, shown.month),
    () => fetchTraegerTimeAccount(recordId, shown.year, shown.month),
    "das Stundenkonto",
  );
  const [dialog, setDialog] = useState<"close" | "reopen" | null>(null);
  // The close confirms the month as the dialog opened on it (ADR 0311);
  // after a refusal the month is read again (one access-log entry).
  const closing = useDraftOn<
    TraegerTimeAccount,
    TraegerTimeAccount,
    string,
    TraegerTimeAccount
  >(
    {
      opening:
        dialog === "close"
          ? traegerStaffKeys.timeAccount(recordId, shown.year, shown.month)
          : null,
      data: account ?? undefined,
      reload: reloadOrThrow,
    },
    {
      token: (month) => month.fingerprint,
      follow: false,
      answer: (saved) => saved,
    },
  );
  // The read a refusal started, for the message beside the card.
  const refusalReload = useRef<(() => Promise<unknown>) | undefined>(undefined);
  const actionErrors = useApiErrorDisplay();

  const isThisMonth =
    shown.year === thisMonth.year && shown.month === thisMonth.month;
  const shownLabel = monthKeyLabel(shown);

  const columns = useMemo<DataTableColumn<TraegerTimeAccountSchool>[]>(
    () => [
      {
        key: "school",
        header: "Schule",
        stacked: "title",
        render: (school) => (
          <span className="font-medium text-gray-900">{school.schoolName}</span>
        ),
      },
      {
        key: "target",
        header: "Soll",
        align: "right",
        stacked: "field",
        render: (school) =>
          school.hasTarget ? (
            <span className="text-gray-700 tabular-nums">
              {formatDuration(school.targetMinutes)}
            </span>
          ) : (
            <StatusBadge label="Kein Soll" tone="warning" compact />
          ),
      },
      {
        key: "actual",
        header: "Ist",
        align: "right",
        stacked: "field",
        render: (school) => (
          <span className="text-gray-700 tabular-nums">
            {formatDuration(school.actualMinutes + school.creditedMinutes)}
          </span>
        ),
      },
      {
        key: "balance",
        header: "Saldo",
        align: "right",
        stacked: "field",
        render: (school) => (
          <span
            className={`font-semibold tabular-nums ${saldoText(school.balanceMinutes)}`}
          >
            {formatSignedDuration(school.balanceMinutes)}
          </span>
        ),
      },
      {
        key: "closing",
        header: "Kontostand",
        align: "right",
        stacked: "field",
        render: (school) => (
          <span className="text-gray-700 tabular-nums">
            {formatSignedDuration(school.closingBalanceMinutes)}
          </span>
        ),
      },
      {
        key: "state",
        header: "Abschluss",
        stacked: "meta",
        render: (school) => (
          <span className="flex flex-col items-start gap-1">
            <SchoolMonthBadge school={school} />
            {school.closed && school.closedAt ? (
              <span className="text-xs text-gray-500 tabular-nums">
                am {formatBerlinDate(school.closedAt)}
              </span>
            ) : null}
            {school.closed && school.driftMinutes !== 0 ? (
              <span className="text-xs text-gray-600 tabular-nums">
                Seitdem {formatSignedDuration(school.driftMinutes)} geändert
              </span>
            ) : null}
          </span>
        ),
      },
    ],
    [],
  );

  const blocked = account ? closeBlocker(account) : null;
  const reopenBlocked = account ? reopenBlocker(account) : null;
  const closedBySchool =
    account?.schools.filter(
      (school) => school.byTraeger && school.closed && !school.closedByTraeger,
    ) ?? [];

  // Abschließen, solange eine Schule mit Vertrag offen ist; wieder öffnen,
  // sobald der Träger an einer Schule abgeschlossen hat, auch nach einem
  // halb fertigen Abschluss (ADR 0243 Punkt 4).
  const canReopen =
    account?.schools.some((school) => school.closedByTraeger) ?? false;
  const headAction = (
    <>
      {account?.state === "open" ? (
        <Button
          type="button"
          size="md"
          variant="primary"
          className="gap-2"
          disabled={Boolean(blocked)}
          disabledReason={blocked ?? undefined}
          tooltip="Öffnet ein Fenster, um den Monat an allen Schulen festzuschreiben."
          onClick={() => setDialog("close")}
        >
          <Lock className="h-4 w-4" aria-hidden />
          Monat abschließen
        </Button>
      ) : null}
      {canReopen ? (
        <Button
          type="button"
          size="md"
          variant="outline_danger"
          className="gap-2"
          disabled={Boolean(reopenBlocked)}
          disabledReason={reopenBlocked ?? undefined}
          tooltip="Hebt deinen Abschluss an allen Schulen auf. moto fragt vorher nach."
          onClick={() => setDialog("reopen")}
        >
          <LockOpen className="h-4 w-4" aria-hidden />
          Wieder öffnen
        </Button>
      ) : null}
    </>
  );

  return (
    <SectionCard
      concept={timeTrackingConcept}
      title="Stundenkonto"
      titleBadge={
        account?.state ? (
          <StatusBadge
            label={STATE_BADGE[account.state].label}
            tone={STATE_BADGE[account.state].tone}
            compact
          />
        ) : undefined
      }
      description={`${shownLabel} · Soll und Ist an allen Schulen der Person. Jede Schule rechnet ihren Teil selbst.`}
      actions={
        <>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Vorheriger Monat"
            tooltip="Zeigt das Stundenkonto des Vormonats."
            onClick={() => setShown((current) => shift(current, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Nächster Monat"
            tooltip="Zeigt das Stundenkonto des Folgemonats."
            disabled={isThisMonth}
            disabledReason="Der laufende Monat ist der neueste Monat."
            onClick={() => setShown((current) => shift(current, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {headAction}
        </>
      }
      loading={account === null && !error}
      bodyClassName="mt-4 space-y-4"
    >
      {error ? (
        <LoadErrorAlert error={error} actionLayout="responsive" />
      ) : account ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              variant="tile"
              label={account.ended ? "Soll" : "Soll bis heute"}
              value={formatDuration(account.targetMinutes)}
            />
            <StatCard
              variant="tile"
              label="Ist mit Gutschriften"
              value={formatDuration(
                account.actualMinutes + account.creditedMinutes,
              )}
            />
            <StatCard
              variant="tile"
              label="Saldo des Monats"
              value={formatSignedDuration(account.balanceMinutes)}
              tone={saldoTone(account.balanceMinutes)}
            />
            <StatCard
              variant="tile"
              label="Kontostand"
              value={formatSignedDuration(account.closingBalanceMinutes)}
              tone={saldoTone(account.closingBalanceMinutes)}
            />
          </div>

          {account.state === "school" ? (
            <Alert
              type="info"
              announce="off"
              message="Kein Arbeitsvertrag beim Träger gilt in diesem Monat. Jede Schule schließt ihn selbst ab."
            />
          ) : blocked && account.ended ? (
            <Alert type="warning" announce="off" message={blocked} />
          ) : null}
          {closedBySchool.length > 0 ? (
            <Alert
              type="info"
              announce="off"
              message={`${closedBySchool.map((school) => school.schoolName).join(", ")} hat diesen Monat selbst abgeschlossen. Diesen Abschluss öffnet nur die Schule.`}
            />
          ) : null}

          <DataTable
            columns={columns}
            rows={[...account.schools]}
            getRowKey={(school) => school.schoolId}
            stackedOnMobile
            emptyState="Die Person arbeitet an keiner Schule mehr."
          />
        </>
      ) : null}

      {dialog === "close" && account ? (
        <MonthCloseReasonModal
          title={`${shownLabel} abschließen`}
          description={
            <>
              <p>
                Der Abschluss schreibt das Stundenkonto an{" "}
                <strong>jeder Schule mit deinem Vertrag</strong> zum Monatsende
                fest.
              </p>
              <p>
                Danach ändert keine Schule mehr Zeiten oder Buchungen in diesem
                Monat. Der Kontostand geht in den nächsten Monat.
              </p>
              <p>Den Abschluss öffnet nur die Personalverwaltung wieder.</p>
            </>
          }
          submitLabel="Monat abschließen"
          submitTooltip="Schreibt den Monat an allen Schulen mit deinem Vertrag fest."
          successMessage={`${shownLabel} ist abgeschlossen.`}
          onSubmit={async (reason) => {
            const result = await closing.submit((fingerprint) =>
              closeTraegerTimeAccountMonth(recordId, {
                ...shown,
                reason,
                expectedFingerprint: fingerprint,
              }),
            );
            if (result.ok) {
              await mutate(result.saved, { revalidate: false });
              return;
            }
            // Schulen vor dem Fehler sind schon abgeschlossen: neu laden.
            // Nach einer Ablehnung liest `result.reload` den Monat.
            if (result.refused) refusalReload.current = result.reload;
            else reload();
            throw result.error;
          }}
          // Die neuen Salden stehen nur auf der Karte: der Dialog schließt,
          // die Person sieht sie, bevor sie erneut abschließt.
          onChangedSinceRead={(err) =>
            void actionErrors.show(err, {
              object: "das Abschließen des Monats",
              reload: refusalReload.current,
            })
          }
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "reopen" && account ? (
        <MonthCloseReasonModal
          title={`${shownLabel} wieder öffnen`}
          description={
            <>
              <p>
                Hebt den Abschluss an <strong>jeder Schule</strong> auf, die du
                abgeschlossen hast.
              </p>
              <p>
                Danach ändern die Schulen den Monat wieder. Das wirkt auf alle
                späteren Monate.
              </p>
            </>
          }
          submitLabel="Wieder öffnen"
          submitTooltip="Hebt den Abschluss an allen Schulen auf. Die Schulen ändern den Monat danach wieder."
          successMessage={`${shownLabel} ist wieder offen.`}
          errorObject="das Öffnen des Monats"
          destructive
          onSubmit={async (reason) => {
            try {
              await mutate(
                await reopenTraegerTimeAccountMonth(recordId, {
                  ...shown,
                  reason,
                }),
                { revalidate: false },
              );
            } catch (err) {
              reload();
              throw err;
            }
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </SectionCard>
  );
}
