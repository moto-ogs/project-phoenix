"use client";

/**
 * VertretungWeekList — die Störungsliste der Wochenansicht (#2030).
 *
 * Dieselbe Liste wie die Tagesansicht, nur nach Wochentagen gruppiert: pro Tag
 * eine Kopfzeile mit Störungszähler, darunter die Zeilen aus
 * `VertretungRowList`. Klassifikation, Sortierung und Zeilendarstellung kommen
 * unverändert aus vertretung-day-list.tsx — es gibt genau eine
 * Störungsdefinition, nicht eine je Ansicht.
 *
 * Reine Präsentationskomponente: kein Datenabruf, kein URL-Zugriff. Welche
 * Woche gezeigt wird, ob Lückendaten vorliegen und was ein Tagesklick auslöst,
 * entscheidet der Parent (vertretung-view.tsx).
 *
 * Ein Unterschied zur Tagesansicht ist beabsichtigt: dort fällt ein
 * störungsfreier Tag auf die Ganztagsdarstellung zurück, damit die Fläche nicht
 * leer bleibt. Über fünf Tage hinweg wäre dieser Fallback eine Wand aus
 * ungestörten Zeilen und würde die Störungen genau verdecken, die die Ansicht
 * zeigen soll. Hier bleibt ein störungsfreier Tag daher eine Zeile Text; wer
 * alle Termine sehen will, schaltet auf "Ganze Woche".
 */

import { CoverageIndicator } from "~/components/ui/planning/coverage-indicator";
import { EmptyState } from "~/components/ui/empty-state";
import {
  SectionCard,
  SECTION_CARD_BODY_GAP,
} from "~/components/ui/section-card";
import { SECTION_LABEL_CLASS } from "~/components/ui/section-label";
import { StatusBadge } from "~/components/ui/status-badge";
import { ListGroupHeader } from "~/components/ui/list-group-header";
import {
  classifyInstances,
  VertretungRowList,
  vertretungRowFocusKey,
  type ClassifiedRow,
  type VertretungDayListMode,
} from "~/components/timetable/vertretung-day-list";
import { useState, type ReactNode } from "react";

import { formatDayHeader, toISODate } from "~/lib/timetable-helpers";
import type { EnrichedInstance, GapInstance } from "~/lib/timetable-types";

import { VertretungListFilter } from "./vertretung-list-filter";
import { cn } from "~/lib/utils";

export interface VertretungWeekListProps {
  /** Überschrift der Karte: sagt, wessen Termine sie zeigt. */
  title: string;
  /**
   * Ein Hinweis für die ganze Woche, etwa der Ladefehler der Lücken mit
   * „Wiederholen“. Er steht einmal über den Tagen, nicht in jedem Tag.
   */
  gapsNotice?: ReactNode;
  /** Die Lücken laden noch: Platzhalter statt einer Aussage zur Besetzung. */
  gapsLoading?: boolean;
  /** Die angezeigten Wochentage (Mo–Fr). */
  weekDays: Date[];
  /** Alle Instanzen der geladenen Woche (Filterung nach Tag passiert hier). */
  instances: EnrichedInstance[];
  /** Offene Lücken der Woche (GapsResponse.gaps, ungefiltert). */
  gaps: GapInstance[];
  /** Quittierte Lücken der Woche (GapsResponse.acknowledged, ungefiltert). */
  acknowledged: GapInstance[];
  /**
   * Erster Tag (ISO), für den Lückendaten vorliegen — der Endpunkt ist
   * vorwärtsgerichtet, in der laufenden Woche fehlen die vergangenen Tage.
   * `null` heißt: für keinen Tag der Woche liegen Lückendaten vor.
   */
  gapsAvailableFrom: string | null;
  staffNames: Map<string, string>;
  mode: VertretungDayListMode;
  /** Setzt den Filter. Ohne Callback wird die Filterzeile nicht gerendert. */
  onModeChange?: (mode: VertretungDayListMode) => void;
  canManage: boolean;
  onEdit: (instanceId: string) => void;
  /** Klick auf eine Tageskopfzeile — springt in die Tagesansicht des Tages. */
  onSelectDay: (dateISO: string) => void;
  /** Weg in den Betreuungsplan eines Tages; siehe VertretungDayList. */
  carePlanHrefFor?: (dateISO: string) => string;
  todayISO: string;
  className?: string;
}

/** Innenkante der Karte, dieselbe wie in der Tagesliste. */
const LIST_INSET = "compact:px-4 px-5 max-sm:px-4";

export function VertretungWeekList({
  title,
  gapsNotice,
  gapsLoading = false,
  weekDays,
  instances,
  gaps,
  acknowledged,
  gapsAvailableFrom,
  staffNames,
  mode,
  onModeChange,
  canManage,
  onEdit,
  onSelectDay,
  carePlanHrefFor,
  todayISO,
  className,
}: VertretungWeekListProps) {
  // Was an einem Tag schon geregelt ist, steht eingeklappt unter seinen
  // offenen Lücken (#7493): über die Woche fällt so auf, was noch zu tun ist.
  const [openSettledDays, setOpenSettledDays] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const toggleSettled = (iso: string) =>
    setOpenSettledDays((current) => {
      const next = new Set(current);
      if (!next.delete(iso)) next.add(iso);
      return next;
    });
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
  // flex-col: Kopf und Hinweis bleiben stehen, nur die Liste darunter scrollt.
  return (
    <SectionCard
      title={title}
      description={
        canManage
          ? undefined
          : "Nur zur Ansicht. Vertretungen trägt die Leitung ein."
      }
      action={
        onModeChange ? (
          <VertretungListFilter
            mode={mode}
            onModeChange={onModeChange}
            allLabel="Ganze Woche"
          />
        ) : undefined
      }
      // Die Platzhalter des Ladezustands behalten den Innenrand der Karte.
      flush={!gapsLoading}
      loading={gapsLoading}
      overflow="visible"
      className={cn("flex flex-col", className)}
      bodyClassName={`${SECTION_CARD_BODY_GAP} flex min-h-0 flex-1 flex-col`}
      testId="vertretung-week-list"
    >
      {gapsNotice != null && (
        <div className={`${LIST_INSET} shrink-0 pb-3`}>{gapsNotice}</div>
      )}
      {/* Der Scroll-Container sitzt INNERHALB der Karte (die Karte selbst
          bekommt vom Aufrufer nur die Höhe und overflow-hidden): so bleibt die
          Scrollleiste innerhalb des Rahmens und die abgerundeten Ecken bleiben
          sauber, statt dass die Leiste auf dem Rand klebt. Die sticky
          Tageskopfzeilen kleben an diesem Container. */}
      {/* `scroll-pt`: was der Fokus in Sicht holt, landet unter der klebenden
          Tageskopfzeile statt dahinter. */}
      <div className="min-h-0 flex-1 scroll-pt-12 overflow-y-auto rounded-b-2xl">
        {weekDays.map((day) => {
          const iso = toISODate(day);
          const gapsAvailable =
            gapsAvailableFrom !== null && iso >= gapsAvailableFrom;
          const dayInstances = instances.filter((inst) => inst.date === iso);
          const dayGaps = gaps.filter((gap) => gap.date === iso);
          const dayAcknowledged = acknowledged.filter(
            (gap) => gap.date === iso,
          );
          const classified = classifyInstances(
            dayInstances,
            dayGaps,
            dayAcknowledged,
            gapsAvailable,
          );
          // Reihenfolge der Arbeit (#7493): zuerst, was offen ist, dann
          // was geregelt ist, zuletzt die Termine wie geplant.
          const open = classified.filter((row) => row.coverageState === "gap");
          const settled = classified.filter(
            (row) => row.isDisturbed && row.coverageState !== "gap",
          );
          // „Ganze Woche“ zeigt jeden Tag in seiner Reihenfolge nach Uhrzeit.
          const visibleRows =
            mode === "ganzer-tag" ? classified : [...open, ...settled];
          const isPast = iso < todayISO;
          const settledExpanded = openSettledDays.has(iso);

          // Die Kopfzeile nennt, was an dem Tag zu tun ist: die offenen
          // Lücken. Ohne geladene Lückendaten bleibt sie still, statt eine 0
          // zu erfinden (Muster der Tagesansicht).
          const openLabel =
            open.length === 0
              ? "keine Lücke offen"
              : open.length === 1
                ? "1 offene Lücke"
                : `${open.length} offene Lücken`;

          return (
            <section
              key={iso}
              data-testid={`vertretung-week-list-day-${iso}`}
              // Verlässt eine Zeile nach dem Speichern die Liste ganz, bleibt
              // der Fokus an ihrem Tag (#7502).
              data-focus-return-scope=""
              className="border-b border-gray-100 last:border-b-0"
            >
              <button
                type="button"
                onClick={() => onSelectDay(iso)}
                aria-label={`${formatDayHeader(day)} als Tagesansicht öffnen`}
                // Sticky, weil der Aufrufer die Liste in einen scrollenden
                // Container mit der Höhe des Rasters setzt: beim Scrollen muss
                // sichtbar bleiben, zu welchem Tag die Zeilen gehören. Deckender
                // Hintergrund (kein /70), sonst scheinen die Zeilen durch.
                className="compact:px-4 sticky top-0 z-10 flex w-full items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-5 py-2 text-left transition-colors hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:outline-none focus-visible:ring-inset max-sm:px-4"
              >
                <span className="flex items-center gap-2">
                  <span className={SECTION_LABEL_CLASS}>
                    {formatDayHeader(day)}
                  </span>
                  {iso === todayISO && (
                    <StatusBadge label="Heute" tone="gray" size="xs" />
                  )}
                </span>
                {gapsAvailable && dayInstances.length > 0 && (
                  <CoverageIndicator
                    size="sm"
                    state={open.length > 0 ? "gap" : "covered"}
                    label={openLabel}
                    title={`${openLabel} an diesem Tag`}
                  />
                )}
                {/* Ein vergangener Tag hat keine Lückenzahl; das Wort sagt,
                    warum die Stelle leer ist. */}
                {!gapsAvailable && isPast && (
                  <span className="text-xs text-gray-500">vorbei</span>
                )}
              </button>

              {dayInstances.length === 0 ? (
                <div className={LIST_INSET}>
                  <EmptyState
                    variant="compact"
                    description="Keine Termine an diesem Tag."
                  />
                </div>
              ) : visibleRows.length === 0 ? (
                // Ein vergangener Tag ohne Ausfall braucht keinen Satz: die
                // Kopfzeile sagt „vorbei“.
                isPast && !gapsAvailable ? null : (
                  <div className={LIST_INSET}>
                    <EmptyState
                      variant="compact"
                      description={
                        gapsAvailable
                          ? "Keine Lücke und kein Ausfall an diesem Tag."
                          : "Kein Ausfall eingetragen."
                      }
                    />
                  </div>
                )
              ) : mode === "ganzer-tag" ? (
                rowList(visibleRows)
              ) : (
                <>
                  {open.length > 0 && rowList(open)}
                  {settled.length > 0 && (
                    <>
                      <ListGroupHeader
                        as="h4"
                        // Ohne Lückendaten weiß die Liste nicht, ob es
                        // geregelt ist: sie nennt, was die Termine sagen.
                        title={
                          gapsAvailable
                            ? "Schon geregelt"
                            : "Abwesend oder abgesagt"
                        }
                        meta={settled.length}
                        collapsible={{
                          expanded: settledExpanded,
                          onToggle: () => toggleSettled(iso),
                          // Eine besetzte Lücke wandert hier hinein und ist
                          // eingeklappt nicht zu sehen: der Gruppenname
                          // nimmt dann ihren Fokus (#7502).
                          focusReturn: settledExpanded
                            ? undefined
                            : settled
                                .map((row) =>
                                  vertretungRowFocusKey(row.instance.id),
                                )
                                .join(" "),
                        }}
                        className={LIST_INSET}
                      />
                      {settledExpanded && rowList(settled)}
                    </>
                  )}
                </>
              )}
            </section>
          );
        })}
      </div>
    </SectionCard>
  );
}
