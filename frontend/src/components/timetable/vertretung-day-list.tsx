"use client";

/**
 * VertretungDayList: die Störungsliste des Vertretungsbereichs.
 *
 * Reine Präsentationskomponente: kein Datenabruf, kein URL-Zugriff. Welcher
 * Tag angezeigt wird und der Umschalter "Nur Störungen"/"Ganzer Tag" leben im
 * Parent (vertretung-view.tsx); der Filterzustand kommt hier nur als Prop an.
 *
 * Die Klassifikation (`classifyInstances`) und die Zeilendarstellung
 * (`VertretungRowList`) sind exportiert, weil die Wochenansicht
 * (vertretung-week-list.tsx, #2030) dieselben Regeln pro Tag anwendet. Es gibt
 * genau eine Störungsdefinition, nicht zwei je Ansicht.
 *
 * Störungsdefinition (Abschnitt 2.2, Bedingungen 1-4): eine Position gilt als
 * gestört, wenn sie in `gaps` steht (offene Lücke), in `acknowledged` steht
 * (quittiert), `status === "cancelled"` ist (abgesagt), oder mindestens eine
 * geplante (nicht substituierende) Person `isAbsent === true` hat — auch mit
 * bereits gesetztem Ersatz bleibt die Störung sichtbar. Bei gleicher
 * Startzeit ordnet ein Schwere-Sekundärschlüssel: offene Lücke vor
 * Abwesenheit-mit-Ersatz vor quittiert vor abgesagt.
 *
 * Reihenfolge der Arbeit (#7493): die Liste gruppiert nach dem, was zu tun
 * ist. Zuerst die offenen Lücken, dann, was schon geregelt ist (Ersatz,
 * bewusst unbesetzt, abgesagt), zuletzt die Termine wie geplant. Ist keine
 * Lücke offen, steht an der Stelle der ersten Gruppe ein Ergebnis mit dem
 * nächsten Tag, an dem noch etwas offen ist.
 */

import { CircleCheck } from "lucide-react";
import type { ReactNode } from "react";

import { Alert } from "~/components/ui/alert";
import { EmptyState } from "~/components/ui/empty-state";
import { ListGroupHeader } from "~/components/ui/list-group-header";
import { SectionCard } from "~/components/ui/section-card";
import { Button, ButtonLink } from "~/components/ui/button";
import {
  CoverageIndicator,
  type CoverageState,
} from "~/components/ui/planning/coverage-indicator";
import {
  BlockStaffNames,
  blockPlaceLine,
  blockStaffEntries,
} from "~/components/timetable/block-staff-names";
import { staffLabel } from "~/lib/timetable-helpers";
import type {
  EnrichedInstance,
  GapInstance,
  InstanceStaffSummary,
} from "~/lib/timetable-types";

import {
  VertretungListFilter,
  type VertretungDayListMode as FilterMode,
} from "./vertretung-list-filter";

// Der Typ lebt beim Filter (siehe dort), wird hier aber unter dem gewohnten
// Namen weitergereicht, damit die bestehenden Aufrufer nichts ändern müssen.
export type VertretungDayListMode = FilterMode;

export interface StaffTriple {
  readonly planned: number;
  readonly present: number;
  readonly absent: number;
}

/** Der nächste andere Tag der Woche, an dem noch eine Lücke offen ist. */
interface VertretungNextOpenDay {
  /** Wie der Tag in der Wochenleiste heißt, z. B. "Do 19.11.". */
  readonly label: string;
  readonly count: number;
  readonly onSelect: () => void;
}

export interface VertretungDayListProps {
  /** Überschrift der Karte: sagt, wessen Termine sie zeigt. */
  title: string;
  /** Alle Instanzen des angezeigten Tages. */
  instances: EnrichedInstance[];
  /** Offene Lücken des Tages (GapsResponse.gaps, bereits tagesgefiltert). */
  gaps: GapInstance[];
  /** Quittierte Lücken des Tages (GapsResponse.acknowledged, tagesgefiltert). */
  acknowledged: GapInstance[];
  /** Ob offene und quittierte Lücken für den angezeigten Tag geladen wurden. */
  gapsAvailable: boolean;
  /**
   * Was die Liste zeigt, solange `gapsAvailable` falsch ist: der Ladefehler
   * mit „Wiederholen“ oder der Satz für einen vergangenen Tag. Ohne Angabe
   * der allgemeine Hinweis.
   */
  gapsNotice?: ReactNode;
  /** Die Lücken laden noch: Platzhalter statt einer Aussage zur Besetzung. */
  gapsLoading?: boolean;
  /**
   * Für den Ergebniszustand „keine Lücke offen“: wo es weitergeht. `null`
   * heißt, in der geladenen Woche ist sonst nichts offen.
   */
  nextOpenDay?: VertretungNextOpenDay | null;
  /**
   * Anzeigenamen fürs Personal. InstanceStaffSummary trägt nur eine staffId,
   * keinen Namen — die Zeilen "Person abwesend" / "Ersatzkräfte: Namen" brauchen
   * daher eine Namensauflösung, dasselbe Muster wie in
   * substitution-slide-over.tsx.
   */
  staffNames: Map<string, string>;
  mode: VertretungDayListMode;
  /** Setzt den Filter. Ohne Callback wird die Filterzeile nicht gerendert. */
  onModeChange?: (mode: VertretungDayListMode) => void;
  canManage: boolean;
  onEdit: (instanceId: string) => void;
  /**
   * Weg in den Betreuungsplan des Tages, für eine Lücke ohne eingeteilte
   * Person. Ohne Angabe (kein Recht dafür) nennt die Zeile nur den Zustand.
   */
  carePlanHrefFor?: (dateISO: string) => string;
  /**
   * Heute als Berlin-Kalendertag. Damit heißt der Knopf eines vergangenen
   * Termins „Details“: der Editor lässt dort nichts mehr ändern. Ohne Angabe
   * gilt nur `canManage`.
   */
  todayISO?: string;
  className?: string;
}

/**
 * Pure Soll/Ist/Abwesend-Berechnung aus instance.staff — für Zeilen, die nur
 * über Bedingung 3 (abgesagt) oder 4 (Abwesenheit) in die Liste kommen und
 * daher keine GapInstance-Zahlen für diese Instanz haben. Spiegelt die
 * Backend-Semantik von presentStaffCount:
 * geplante Positionen = Zeilen ohne isSubstitute; anwesend = nicht-abwesende
 * geplante Zeilen plus deckende (nicht-abwesende) Substitut-Zeilen; abwesend
 * = alle isAbsent-Zeilen.
 */
export function computeStaffTriple(instance: EnrichedInstance): StaffTriple {
  const plannedRows = instance.staff.filter((row) => !row.isSubstitute);
  const substituteRows = instance.staff.filter((row) => row.isSubstitute);
  const presentPlanned = plannedRows.filter((row) => !row.isAbsent).length;
  const coveringSubstitutes = substituteRows.filter(
    (row) => !row.isAbsent,
  ).length;
  return {
    planned: plannedRows.length,
    present: presentPlanned + coveringSubstitutes,
    absent: instance.staff.filter((row) => row.isAbsent).length,
  };
}

export interface ClassifiedRow {
  instance: EnrichedInstance;
  ackMatch?: GapInstance;
  isCancelled: boolean;
  hasAbsence: boolean;
  absentPlannedRows: InstanceStaffSummary[];
  isDisturbed: boolean;
  severityRank: number;
  coverageState: CoverageState;
  triple: StaffTriple;
}

function classify(
  instance: EnrichedInstance,
  gaps: GapInstance[],
  acknowledged: GapInstance[],
  gapsAvailable: boolean,
): ClassifiedRow {
  const gapMatch = gapsAvailable
    ? gaps.find((g) => g.instanceId === instance.id)
    : undefined;
  const ackMatch = gapsAvailable
    ? acknowledged.find((g) => g.instanceId === instance.id)
    : undefined;
  const isCancelled = instance.status === "cancelled";
  const absentPlannedRows = instance.staff.filter(
    (row) => !row.isSubstitute && row.isAbsent,
  );
  const hasAbsence = absentPlannedRows.length > 0;
  const isGap = gapMatch !== undefined;
  const isAcknowledged = ackMatch !== undefined;
  const isDisturbed = isGap || isAcknowledged || isCancelled || hasAbsence;

  // Schwere-Reihenfolge: offene Lücke vor
  // Abwesenheit-mit-Ersatz (Bedingung 4 ohne offene Lücke) vor quittiert vor
  // abgesagt. Ungestörte Zeilen (nur im Ganztags-Fallback sichtbar) tragen
  // den niedrigsten Rang, damit sie bei einer Zeitgleichheit hinter jeder
  // gestörten Zeile einsortieren.
  let severityRank = 4;
  if (isGap) severityRank = 0;
  else if (hasAbsence) severityRank = 1;
  else if (isAcknowledged) severityRank = 2;
  else if (isCancelled) severityRank = 3;

  const coverageState: CoverageState = isGap
    ? "gap"
    : isAcknowledged
      ? "acknowledged"
      : "covered";

  const gapSource = gapMatch ?? ackMatch;
  const triple: StaffTriple =
    gapSource?.plannedStaffCount !== undefined &&
    gapSource.presentStaffCount !== undefined
      ? {
          planned: gapSource.plannedStaffCount,
          present: gapSource.presentStaffCount,
          absent: gapSource.absentStaffCount,
        }
      : computeStaffTriple(instance);

  return {
    instance,
    ackMatch,
    isCancelled,
    hasAbsence,
    absentPlannedRows,
    isDisturbed,
    severityRank,
    coverageState,
    triple,
  };
}

function compareRows(a: ClassifiedRow, b: ClassifiedRow): number {
  if (a.instance.startTime !== b.instance.startTime) {
    return a.instance.startTime < b.instance.startTime ? -1 : 1;
  }
  return a.severityRank - b.severityRank;
}

/**
 * Klassifiziert und sortiert die Instanzen eines Tages (Startzeit, bei
 * Gleichstand Schwere). Reine Funktion, von Tages- und Wochenansicht geteilt.
 */
export function classifyInstances(
  instances: EnrichedInstance[],
  gaps: GapInstance[],
  acknowledged: GapInstance[],
  gapsAvailable: boolean,
): ClassifiedRow[] {
  return instances
    .map((instance) => classify(instance, gaps, acknowledged, gapsAvailable))
    .sort(compareRows);
}

/** Die Zeilenliste ohne Kartenrahmen — beide Ansichten rendern dieselben Zeilen. */
export function VertretungRowList({
  rows,
  staffNames,
  canManage,
  onEdit,
  carePlanHrefFor,
  todayISO,
}: {
  rows: ClassifiedRow[];
  staffNames: Map<string, string>;
  canManage: boolean;
  onEdit: (instanceId: string) => void;
  carePlanHrefFor?: (dateISO: string) => string;
  todayISO?: string;
}) {
  return (
    <ul className="divide-y divide-gray-100">
      {rows.map((row) => (
        <VertretungDayListRow
          key={row.instance.id}
          row={row}
          staffNames={staffNames}
          // Dieselbe Regel wie im Editor: ändern lässt sich nur ein
          // geplanter oder laufender Termin, der nicht vergangen ist.
          canManage={
            canManage &&
            (todayISO === undefined || row.instance.date >= todayISO) &&
            (row.instance.status === "planned" ||
              row.instance.status === "active")
          }
          onEdit={onEdit}
          carePlanHref={carePlanHrefFor?.(row.instance.date)}
        />
      ))}
    </ul>
  );
}

/** Was mit einer Zeile zu tun ist: besetzen, nichts mehr, oder nie etwas. */
function groupRowsByTask(rows: ClassifiedRow[]) {
  return {
    open: rows.filter((row) => row.coverageState === "gap"),
    settled: rows.filter(
      (row) => row.isDisturbed && row.coverageState !== "gap",
    ),
    planned: rows.filter((row) => !row.isDisturbed),
  };
}

/** Innenkante der Karte: Titel, Gruppenköpfe und Zeilen stehen auf einer Linie. */
const LIST_INSET = "compact:px-4 px-5 max-sm:px-4";

function nextOpenDayText(next: VertretungNextOpenDay | null): string {
  if (next === null) return "Auch sonst ist in dieser Woche keine Lücke offen.";
  return next.count === 1
    ? `Am ${next.label} ist noch 1 Lücke offen.`
    : `Am ${next.label} sind noch ${next.count} Lücken offen.`;
}

export function VertretungDayList({
  title,
  instances,
  gaps,
  acknowledged,
  gapsAvailable,
  gapsNotice,
  gapsLoading = false,
  nextOpenDay,
  staffNames,
  mode,
  onModeChange,
  canManage,
  onEdit,
  carePlanHrefFor,
  todayISO,
  className,
}: VertretungDayListProps) {
  const filter = onModeChange ? (
    <VertretungListFilter
      mode={mode}
      onModeChange={onModeChange}
      allLabel="Ganzer Tag"
    />
  ) : undefined;
  const rowList = (rows: ClassifiedRow[]) => (
    <VertretungRowList
      rows={rows}
      staffNames={staffNames}
      canManage={canManage}
      onEdit={onEdit}
      carePlanHrefFor={carePlanHrefFor}
      todayISO={todayISO}
    />
  );
  const group = (heading: string, rows: ClassifiedRow[]) =>
    rows.length === 0 ? null : (
      <section>
        <ListGroupHeader title={heading} className={LIST_INSET} />
        {rowList(rows)}
      </section>
    );

  const classified = classifyInstances(
    instances,
    gaps,
    acknowledged,
    gapsAvailable,
  );
  const { open, settled, planned } = groupRowsByTask(classified);
  const wholeDay = mode === "ganzer-tag";

  const gapsUnavailableNotice = (
    <div className={`${LIST_INSET} pb-3`}>
      {gapsNotice ?? (
        <Alert
          type="warning"
          message="Störungslage konnte nicht vollständig geprüft werden"
        />
      )}
    </div>
  );

  let body: ReactNode;
  if (instances.length === 0) {
    body = (
      <div className={`${LIST_INSET} pb-3`}>
        <EmptyState variant="compact" title="Keine Termine an diesem Tag" />
      </div>
    );
  } else if (wholeDay) {
    // „Ganzer Tag“ ist der Tag in seiner Reihenfolge: nach Uhrzeit, ohne
    // Gruppen. Die Arbeitssicht mit den Gruppen ist „Nur Störungen“.
    body = (
      <>
        {!gapsAvailable && gapsUnavailableNotice}
        {rowList(classified)}
      </>
    );
  } else if (gapsAvailable) {
    body = (
      <>
        <section>
          {/* Ohne Zahl: die steht in der Statuszeile der Seite, und eine
              Zahl steht einmal (#7493). */}
          <ListGroupHeader title="Offene Lücken" className={LIST_INSET} />
          {open.length > 0 ? (
            rowList(open)
          ) : (
            // Ergebnis statt leerer Gruppe: was erreicht ist und wo es
            // weitergeht.
            <div className={`${LIST_INSET} py-2`}>
              <EmptyState
                variant="compact"
                tone="success"
                icon={<CircleCheck aria-hidden="true" />}
                title="An diesem Tag ist keine Lücke offen"
                description={
                  nextOpenDay === undefined
                    ? undefined
                    : nextOpenDayText(nextOpenDay)
                }
                action={
                  nextOpenDay ? (
                    <Button
                      type="button"
                      variant="surface"
                      size="compact"
                      tooltip="Zeigt den Tag mit den nächsten offenen Lücken."
                      onClick={nextOpenDay.onSelect}
                    >
                      {nextOpenDay.label} zeigen
                    </Button>
                  ) : undefined
                }
              />
            </div>
          )}
        </section>
        {group("Schon geregelt", settled)}
        {/* Ein Tag ganz ohne Störung zeigt seine Termine trotzdem, damit die
            Fläche nicht leer bleibt. */}
        {open.length === 0 &&
          settled.length === 0 &&
          group("Wie geplant", planned)}
      </>
    );
  } else {
    // Ohne Lückendaten behauptet die Liste keine offene oder besetzte Lage:
    // sie zeigt nur, was die Termine selbst sagen (Abwesenheit, Absage), und
    // fällt nicht auf den ganzen Tag zurück.
    body = (
      <>
        {gapsUnavailableNotice}
        {/* Die Überschrift sagt, dass das nicht die geprüfte Lage ist. */}
        {group("Abwesend oder abgesagt", settled)}
      </>
    );
  }

  return (
    <SectionCard
      title={title}
      description={
        canManage
          ? undefined
          : "Nur zur Ansicht. Vertretungen trägt die Leitung ein."
      }
      action={filter}
      // Die Platzhalter des Ladezustands behalten den Innenrand der Karte.
      flush={!(gapsLoading && instances.length > 0)}
      loading={gapsLoading && instances.length > 0}
      className={className}
    >
      {body}
    </SectionCard>
  );
}

function VertretungDayListRow({
  row,
  staffNames,
  canManage,
  onEdit,
  carePlanHref,
}: {
  row: ClassifiedRow;
  staffNames: Map<string, string>;
  canManage: boolean;
  onEdit: (instanceId: string) => void;
  carePlanHref?: string;
}) {
  const {
    instance,
    isDisturbed,
    hasAbsence,
    isCancelled,
    ackMatch,
    absentPlannedRows,
    triple,
    coverageState,
  } = row;
  // "Ganzer Tag" blendet ungestörte Positionen gedämpft grau ein, ohne
  // Störungsvermerke — die Vermerke selbst bleiben
  // ohnehin aus, weil ihre Bedingungen für eine ungestörte Zeile nie zutreffen.
  const titleClass = isDisturbed ? "text-gray-900" : "text-gray-500";
  const isOpenGap = coverageState === "gap";
  // Eine Lücke ohne eingeteilte Person lässt sich hier nicht besetzen: es
  // gibt niemanden zu vertreten. Die Zeile sagt das, statt „0/0“ zu zeigen,
  // und verspricht kein „Besetzen“.
  const nobodyPlanned = isOpenGap && triple.planned === 0;
  const canFill = isOpenGap && !nobodyPlanned;
  const missing = Math.max(triple.planned - triple.present, 1);
  const rowAction = !canManage
    ? "Details"
    : canFill
      ? "Besetzen"
      : "Bearbeiten";
  const placeLine = blockPlaceLine(instance);
  const staffEntries = isCancelled
    ? []
    : blockStaffEntries(instance.staff, staffNames);
  const timeClass = isDisturbed ? "text-gray-500" : "text-gray-500";
  // Das Datenmodell kennt nur "Ersatz für diesen Block", nicht "Ersatz für
  // diese abwesende Person". Namen daher nur blockweit aggregiert ausgeben.
  const substituteNames = hasAbsence
    ? [
        ...new Set(
          instance.staff
            .filter((row) => row.isSubstitute && !row.isAbsent)
            .map((row) => staffLabel(staffNames, row.staffId)),
        ),
      ]
    : [];

  return (
    <li
      data-testid={`vertretung-day-list-row-${instance.id}`}
      className={`flex flex-col gap-1.5 ${LIST_INSET} py-3`}
    >
      {/* Kein Umbruch: der Knopf bleibt bei jeder Titellänge oben rechts an
          derselben Stelle, der Text bricht in seiner Spalte um. */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={`text-xs font-medium tabular-nums ${timeClass}`}>
            {instance.startTime}–{instance.endTime}
          </span>
          <span className={`text-sm font-semibold ${titleClass}`}>
            {instance.title}
          </span>
          {/* #3817: Raum, Gruppe und wer eingeteilt ist, ohne den Editor zu
              öffnen. */}
          {placeLine !== "" && (
            <span className="text-xs text-gray-500">{placeLine}</span>
          )}
          <BlockStaffNames entries={staffEntries} />
        </div>
        {/* Auch Lesenutzer brauchen ein Klickziel: unterhalb lg gibt es keine
            Kalenderspalte, und der Verlauf muss ohne schedules:manage lesbar
            bleiben (Kriterium 8). Der Editor selbst rendert ohne canManage
            nur Lese-Inhalte.
            Mit Verwaltungsrechten nennt die Zeile einer offenen Lücke das
            Ergebnis des Klicks: „Besetzen“ (#7493). Was schon geregelt ist,
            heißt „Bearbeiten“, ohne die Rechte oder bei einem vergangenen
            Termin „Details“. Alle tragen die weiße Kit-Fläche mit Rahmen
            (#2029): gleichrangige Zeilenaktionen sehen gleich aus, und eine
            Liste mit sieben Lücken hat nicht sieben Primärknöpfe. „Details“
            war eine Ghost-Variante ohne Rahmen und las sich als Beschriftung
            statt als Knopf; dass hier nichts zu ändern ist, sagt das Wort. */}
        <Button
          type="button"
          variant="outline"
          size="compact"
          tooltip={
            canManage
              ? "Öffnet Abwesenheit und Ersatz für diesen Termin."
              : "Zeigt Besetzung und Verlauf dieses Termins."
          }
          aria-label={`${rowAction}: ${instance.title}, ${instance.startTime}`}
          className="shrink-0"
          onClick={() => onEdit(instance.id)}
        >
          {rowAction}
        </Button>
      </div>

      {nobodyPlanned ? (
        <div className="flex flex-wrap items-center gap-3">
          <CoverageIndicator
            state="gap"
            label="Niemand eingeteilt"
            title="Für diesen Termin ist niemand eingeteilt"
          />
          {/* Der Hinweis nennt einen anderen Ort, also führt er dorthin
              (#7054). */}
          {carePlanHref !== undefined && (
            <ButtonLink
              href={carePlanHref}
              variant="surface"
              size="compact"
              tooltip="Öffnet den Betreuungsplan an diesem Tag, um Personal einzuteilen."
            >
              Im Betreuungsplan einteilen
            </ButtonLink>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {/* In Worten statt als nackter Bruch: „3 von 4 da“. */}
          <CoverageIndicator
            state={coverageState}
            label={`${triple.present} von ${triple.planned} da`}
            title={`${triple.present} von ${triple.planned} Personen da`}
            note={
              coverageState === "acknowledged" ? "bewusst unbesetzt" : undefined
            }
          />
          {/* Eine Zahl je Zeile (#7493): der Bruch sagt „da von geplant“,
              die Worte daneben, was bei einer Lücke fehlt. Wer fehlt, steht
              darunter mit Namen. */}
          {isOpenGap && (
            <span className="text-xs font-medium text-gray-700">
              {missing === 1 ? "1 Person fehlt" : `${missing} Personen fehlen`}
            </span>
          )}
        </div>
      )}

      {hasAbsence && (
        <div className="flex flex-col gap-1 text-xs text-gray-600">
          <ul className="flex flex-col gap-1">
            {absentPlannedRows.map((staffRow) => {
              const name = staffLabel(staffNames, staffRow.staffId);
              return (
                <li key={staffRow.staffId}>
                  <span className="font-medium text-gray-900">{name}</span>
                  {" abwesend"}
                  {staffRow.absenceReason ? ` (${staffRow.absenceReason})` : ""}
                </li>
              );
            })}
          </ul>
          <p>
            Ersatzkräfte:{" "}
            {substituteNames.length > 0 ? substituteNames.join(", ") : "keine"}
          </p>
        </div>
      )}

      {ackMatch?.understaffedNote && (
        <p className="text-xs text-gray-500">
          Grund: {ackMatch.understaffedNote}
        </p>
      )}

      {isCancelled && (
        <p className="text-xs text-gray-600">
          abgesagt{instance.cancelReason ? `: ${instance.cancelReason}` : ""}
        </p>
      )}
    </li>
  );
}
