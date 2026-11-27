"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useSession } from "next-auth/react";

import {
  HomeCard,
  HomeCardEmpty,
  HomeCardIcon,
} from "~/components/home/home-card";
import {
  childChangeText,
  childSummaryCounts,
  childSummaryTitle,
  dayChangeSpan,
  dayChangeText,
  sourceFailureText,
  type DayChangesDay,
} from "~/components/home/day-changes-text";
import {
  trackEntryClick,
  useDayChangeHref,
} from "~/components/home/day-change-link";
import { DayNoticeRow } from "~/components/home/day-notice-row";
import {
  DaySwitch,
  isOverviewOfDay,
  nextDayISO,
} from "~/components/home/day-switch";
import { HOME_TWO_COLUMNS } from "~/components/home/home-card-rows";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { ListGroupHeader } from "~/components/ui/list-group-header";
import { ListRow } from "~/components/ui/list-row";
import { SectionLabel } from "~/components/ui/section-label";
import { Skeleton } from "~/components/ui/skeleton";
import { trackEvent } from "~/lib/analytics";
import { dayChangesConcept } from "~/lib/concepts/dayChanges";
import {
  fetchDayChanges,
  type DayChange,
  type DayChangesOverview,
} from "~/lib/day-changes";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { useCurrentTimestamp } from "~/lib/hooks/use-current-timestamp";
import { BELOW_SM, useMediaQuery } from "~/lib/hooks/use-media-query";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { homeKeys } from "~/lib/swr/portal-keys";
import { cn } from "~/lib/utils";

/**
 * So viele offene Einträge von „Schule“ stehen da, bevor die Karte zählt:
 * fünf wie in jeder langen Liste des Kits, am Telefon drei, damit „Mein Tag“
 * sichtbar bleibt.
 */
const SCHOOL_ROWS = 5;
/** Bis zu so vielen Zeilen bleibt ein Abschnitt einspaltig. */
const SINGLE_COLUMN_ROWS = 3;
const PHONE_SCHOOL_ROWS = 3;

/**
 * Baustein „Heute anders“ (#7659): was heute anders läuft als geplant, zuerst
 * was die Person selbst betrifft, darunter die übrige Schule. Jeder Eintrag
 * führt zur Detailseite. Ein Ereignis, das eine Quelle ändert, lädt den
 * Baustein neu (`useGlobalSSE`). Ist eine Quelle ausgefallen, steht ein
 * Hinweis da und nie die Entwarnung.
 *
 * Innerhalb eines Abschnitts (#7660): neue ganztägige Änderungen, dann die
 * mit Uhrzeit nach Beginn, dann kompakt die langen („seit 3.11.“); diese
 * Reihenfolge liefert das Backend. Was schon vorbei ist, steht eingeklappt
 * am Ende („3 erledigt“). Ein Bildschirmleser hört nur, was sich bei einem
 * Neuladen geändert hat, nie die ganze Liste.
 *
 * Die Karte wächst mit ihrem Inhalt (`data-home-card-fit`). „Betrifft dich“
 * steht immer ganz da. „Schule“ zeigt die ersten Einträge und nennt, wie
 * viele noch folgen (#8134): zwanzig Zeilen am Stück liest niemand, und sie
 * schoben den Rest der Startseite aus dem Bild.
 */
export function DayChangesBlock() {
  const { data: session } = useSession();
  const accountId = session?.user?.id ?? "";
  // Die Vorschau auf morgen (#7657): derselbe Baustein für den nächsten
  // Kalendertag, auch am Wochenende oder an einem Schließtag.
  const [day, setDay] = useState<DayChangesDay>("today");
  const today = useBerlinToday();
  const tomorrow = nextDayISO(today);
  const shown = day === "tomorrow" ? tomorrow : today;
  const date = day === "tomorrow" ? shown : undefined;
  const {
    data: anyDay,
    error,
    isLoading,
    mutate,
  } = useSWRAuth<DayChangesOverview>(
    // Der heutige Schlüssel trägt den Berliner Kalendertag: nach Mitternacht
    // darf nie die gestrige, undatierte Antwort im Cache stehen bleiben.
    homeKeys.dayChanges(accountId, shown),
    () => fetchDayChanges(date),
    // Abgleich beim Fokus des Fensters (#7659), zusätzlich zu den
    // SSE-Ereignissen und dem Abgleich nach erneuter Verbindung.
    { revalidateOnFocus: true },
  );
  const data = isOverviewOfDay(anyDay, shown) ? anyDay : undefined;
  const loadError = useSwrLoadError(error, "die Übersicht „Heute anders“", () =>
    mutate(),
  );

  return (
    <HomeCard
      title="Heute anders"
      leading={<HomeCardIcon concept={dayChangesConcept} />}
      inlineActions
      actions={
        <DaySwitch
          value={day}
          onChange={(next) => {
            if (next === "tomorrow") trackEvent("day_changes_tomorrow_shown");
            setDay(next);
          }}
        />
      }
    >
      <div data-home-card-fit="">
        {(() => {
          if (loadError) return <LoadErrorAlert error={loadError} />;
          if (!data) {
            return isLoading || error || anyDay ? <DayChangesSkeleton /> : null;
          }
          return (
            <DayChangesContent overview={data} day={day} onChanged={mutate} />
          );
        })()}
      </div>
      {/* Ein Wechsel des Tages ist keine neue Änderung: je Tag eine eigene
          Ansage. */}
      <DayChangesAnnouncer key={day} overview={data} />
    </HomeCard>
  );
}

function DayChangesSkeleton() {
  return (
    <div
      data-testid="day-changes-skeleton"
      className="space-y-2"
      aria-hidden="true"
    >
      <Skeleton className="h-4 w-2/5" />
      <Skeleton className="h-3 w-4/5" />
      <Skeleton className="h-3 w-3/5" />
    </div>
  );
}

/** Was die Übersicht zeigt: nur Arten, für die das Frontend einen Satz hat. */
function shownEntries(overview: DayChangesOverview): DayChange[] {
  // Welche Arten einen Satz haben, hängt nicht vom Tag ab.
  return overview.entries.filter((entry) => dayChangeText(entry) !== null);
}

/** Eine Änderung mit Uhrzeit, deren Ende vorbei ist. */
function isDone(entry: DayChange, now: number): boolean {
  if (!entry.endsAt || now === 0) return false;
  const end = Date.parse(entry.endsAt);
  return !Number.isNaN(end) && end <= now;
}

/**
 * Sagt einem Bildschirmleser an, was ein Neuladen geändert hat (#7660): beim
 * ersten Laden nichts, danach „1 neue Änderung“ oder dass sich die Übersicht
 * geändert hat. Ein Neuladen ohne Änderung bleibt still.
 */
function DayChangesAnnouncer({
  overview,
}: {
  readonly overview: DayChangesOverview | undefined;
}) {
  const keys = overview ? dayChangeKeys(shownEntries(overview)) : null;
  // Der Schlüssel hält die Identität einer Zeile; die Signatur enthält jeden
  // Wert, den ihre Darstellung verwendet. So wird auch ein geänderter
  // Zeitraum angesagt, ohne die Zeile als neue Änderung zu zählen.
  const signature = overview
    ? shownEntries(overview)
        .map((entry, index) =>
          JSON.stringify([
            keys?.[index],
            entry.halfDay,
            entry.since,
            entry.until,
            entry.startsAt,
            entry.endsAt,
            entry.people.map((person) => [
              person.name,
              person.role,
              person.isSelf,
            ]),
            entry.groupName,
            entry.count,
            entry.child,
            entry.childSummary,
            entry.activity?.title,
            entry.roomName,
            entry.previousRoomName,
            entry.schoolClass
              ? [
                  entry.schoolClass.name,
                  entry.schoolClass.time,
                  entry.schoolClass.children,
                ]
              : null,
            entry.notice
              ? [
                  entry.notice.id,
                  entry.notice.title,
                  entry.notice.body,
                  entry.notice.important,
                  entry.notice.requiresAcknowledgement,
                  entry.notice.acknowledged,
                ]
              : null,
            entry.closing ? [entry.closing.name, entry.closing.traeger] : null,
            entry.appointment
              ? [
                  entry.appointment.title,
                  entry.appointment.location,
                  entry.appointment.locationChanged,
                  entry.appointment.timeChanged,
                ]
              : null,
          ]),
        )
        .join("|")
    : null;
  const [last, setLast] = useState<{
    keys: readonly string[] | null;
    signature: string | null;
    message: string;
  }>({ keys: null, signature: null, message: "" });
  if (keys && signature !== last.signature) {
    // Abgeleiteter Zustand während des Renderns statt eines Effekts.
    const message = last.keys ? changeMessage(last.keys, keys) : "";
    setLast({
      keys,
      signature,
      // Derselbe Satz zweimal hintereinander würde nicht noch einmal
      // angesagt; ein geschütztes Leerzeichen macht ihn neu.
      message:
        message !== "" && message === last.message
          ? `${message}\u00a0`
          : message,
    });
  }
  return (
    <p className="sr-only" aria-live="polite">
      {last.message}
    </p>
  );
}

function changeMessage(
  before: readonly string[],
  after: readonly string[],
): string {
  const previous = new Set(before);
  const added = after.filter((key) => !previous.has(key)).length;
  if (added === 1) return "„Heute anders“: 1 neue Änderung.";
  if (added > 1) return `„Heute anders“: ${added} neue Änderungen.`;
  return "„Heute anders“ hat sich geändert.";
}

function DayChangesContent({
  overview,
  day,
  onChanged,
}: {
  readonly overview: DayChangesOverview;
  readonly day: DayChangesDay;
  /** Lädt die Übersicht neu, etwa nach einer Kenntnisnahme (#7667). */
  readonly onChanged: () => Promise<unknown>;
}) {
  const now = useCurrentTimestamp();
  const shown = shownEntries(overview);
  const mine = shown.filter((entry) => entry.section === "you");
  const school = shown.filter((entry) => entry.section !== "you");
  const failures = overview.failedSources.map((source) => (
    <Alert
      key={source}
      type="warning"
      size="compact"
      message={sourceFailureText(source)}
    />
  ));

  if (shown.length === 0 && failures.length === 0) {
    return (
      <HomeCardEmpty
        title={
          day === "tomorrow"
            ? "Morgen läuft alles wie geplant."
            : "Heute läuft alles wie geplant."
        }
      />
    );
  }
  return (
    // Erst was die Person betrifft, darunter die Schule, beide über die
    // ganze Breite: nebeneinander stand links eine Zeile und daneben eine
    // lange Liste, und die halbe Karte blieb leer (#8134).
    <div className="@container space-y-4">
      {failures.length > 0 ? <div className="space-y-2">{failures}</div> : null}
      {mine.length > 0 ? (
        <DayChangesSection
          title="Betrifft dich"
          entries={mine}
          day={day}
          now={now}
          onChanged={onChanged}
        />
      ) : null}
      {school.length > 0 ? (
        <DayChangesSection
          title="Schule"
          entries={school}
          day={day}
          now={now}
          onChanged={onChanged}
          folds
        />
      ) : null}
    </div>
  );
}

function DayChangesSection({
  title,
  entries,
  day,
  now,
  onChanged,
  folds = false,
}: {
  readonly title: string;
  readonly entries: readonly DayChange[];
  readonly day: DayChangesDay;
  /** Die Uhr des Browsers in Minuten-Schritten; 0 vor dem ersten Rendern. */
  readonly now: number;
  readonly onChanged: () => Promise<unknown>;
  /** Zeigt nur die ersten Einträge und klappt den Rest auf Wunsch auf. */
  readonly folds?: boolean;
}) {
  const isPhone = useMediaQuery(BELOW_SM);
  const [expanded, setExpanded] = useState(false);
  const headingId = useId();
  const listId = useId();
  const open = entries.filter((entry) => !isDone(entry, now));
  const done = entries.filter((entry) => isDone(entry, now));
  const limit = isPhone ? PHONE_SCHOOL_ROWS : SCHOOL_ROWS;
  const hidden = folds ? Math.max(0, open.length - limit) : 0;
  const visible = hidden > 0 && !expanded ? open.slice(0, limit) : open;

  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <SectionLabel id={headingId} as="h3" className="mb-2">
        {title}
      </SectionLabel>
      {visible.length > 0 ? (
        <ul id={listId} className={listClass(visible.length)}>
          {withKeys(visible).map(([key, entry]) =>
            entry.notice ? (
              <DayNoticeRow
                key={key}
                entry={entry}
                notice={entry.notice}
                onChanged={onChanged}
              />
            ) : (
              <DayChangeRow key={key} entry={entry} day={day} />
            ),
          )}
        </ul>
      ) : null}
      <div className="mt-2 empty:hidden">
        {hidden > 0 ? (
          // Der Knopf bleibt nach dem Aufklappen stehen: wer alles gesehen
          // hat, klappt an derselben Stelle wieder zu.
          <FoldButton
            expanded={expanded}
            controls={listId}
            more
            tooltip={
              expanded
                ? "Zeigt wieder nur die ersten Änderungen der Schule."
                : `Zeigt alle Änderungen der Schule von ${day === "tomorrow" ? "morgen" : "heute"}.`
            }
            onToggle={() => {
              if (!expanded) {
                trackEvent("day_changes_show_all");
                // Der Fokus geht auf den ersten neuen Eintrag: die neuen
                // Zeilen stehen vor dem Knopf, mit Tab käme man nicht hin.
                requestAnimationFrame(() => {
                  document
                    .getElementById(listId)
                    ?.querySelector<HTMLElement>(
                      `:scope > li:nth-child(${limit + 1}) :is(a, button)`,
                    )
                    ?.focus();
                });
              }
              setExpanded(!expanded);
            }}
          >
            {expanded ? "Weniger anzeigen" : `${hidden} weitere anzeigen`}
          </FoldButton>
        ) : null}
        {done.length > 0 ? <DoneChanges entries={done} /> : null}
      </div>
    </section>
  );
}

/**
 * Die Zeilen eines Abschnitts. Ab vier Zeilen stehen sie in einer breiten
 * Karte in zwei Spalten: zwanzig Zeilen untereinander in der halben Breite
 * ließen die andere Hälfte der Karte leer (#8134). `mb-2` statt `space-y`,
 * damit die erste Zeile der rechten Spalte auf Höhe der linken beginnt.
 */
function listClass(rows: number): string {
  return cn(
    "-mb-2 [&>li]:mb-2 [&>li]:break-inside-avoid",
    rows > SINGLE_COLUMN_ROWS && HOME_TWO_COLUMNS,
  );
}

/**
 * Die Klappe am Ende eines Abschnitts. „15 weitere anzeigen“ trägt den Pfeil
 * hinten wie jede lange Liste des Kits (`more`); „3 erledigt“ ist eine eigene
 * Gruppe und trägt ihn vorn.
 */
function FoldButton({
  expanded,
  controls,
  tooltip,
  onToggle,
  more = false,
  children,
}: {
  readonly expanded: boolean;
  readonly controls: string;
  readonly tooltip: string;
  readonly onToggle: () => void;
  /**
   * „N weitere anzeigen“ statt einer Gruppe. Der Knopf ist dann auch das
   * Ziel für den Fokus eines Hinweises, der hinter ihm steht.
   */
  readonly more?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        size="compact"
        className="-ml-2"
        aria-expanded={expanded}
        aria-controls={controls}
        data-day-changes-more={more ? "" : undefined}
        tooltip={tooltip}
        onClick={onToggle}
      >
        {more ? null : (
          <ChevronRight
            aria-hidden
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform",
              expanded && "rotate-90",
            )}
          />
        )}
        {children}
        {more ? (
          <ChevronDown
            aria-hidden
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform",
              expanded && "rotate-180",
            )}
          />
        ) : null}
      </Button>
    </div>
  );
}

/** „3 erledigt“: was heute schon vorbei ist, eingeklappt am Ende. */
function DoneChanges({ entries }: { readonly entries: readonly DayChange[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <>
      <FoldButton
        expanded={open}
        controls={listId}
        tooltip={
          open
            ? "Blendet die Änderungen aus, die heute schon vorbei sind."
            : "Zeigt die Änderungen, die heute schon vorbei sind."
        }
        onToggle={() => {
          if (!open) trackEvent("day_changes_done_expanded");
          setOpen(!open);
        }}
      >
        {entries.length} erledigt
      </FoldButton>
      <ul
        id={listId}
        hidden={!open}
        className={cn("mt-1", listClass(entries.length))}
      >
        {open
          ? withKeys(entries).map(([key, entry]) => (
              <DayChangeRow key={key} entry={entry} muted />
            ))
          : null}
      </ul>
    </>
  );
}

/**
 * Stabil über ein Neuladen hinweg: Abschnitt, Art, Personen, Gruppe und
 * Beginn. Eine Zusammenfassung trägt nur ihre Art, ihre Zahl ändert den
 * Schlüssel nicht. Gleiche Einträge zählen hoch („#2“), damit jeder
 * Schlüssel eindeutig bleibt.
 */
function dayChangeKeys(entries: readonly DayChange[]): string[] {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    if (entry.notice) {
      return `${entry.section}:${entry.kind}:${entry.notice.id}`;
    }
    if (entry.appointment) {
      return `${entry.section}:${entry.kind}:${entry.appointment.id}:${entry.appointment.occurrenceDate ?? ""}`;
    }
    // Ein Kind (#7665) trägt seine ID, eine Zusammenfassung ohne Gruppe
    // ihre Klasse; ein Termin seine ID.
    const people =
      entry.people.map((person) => person.staffId).join(",") ||
      (entry.child?.studentId ?? "");
    const where =
      entry.groupName ??
      entry.childSummary?.schoolClass ??
      entry.schoolClass?.name ??
      "";
    const base = `${entry.section}:${entry.kind}:${people}:${where}:${entry.startsAt ?? ""}:${entry.activity?.id ?? ""}:${entry.schoolClass?.time ?? ""}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}#${count}`;
  });
}

function withKeys(
  entries: readonly DayChange[],
): (readonly [string, DayChange])[] {
  const keys = dayChangeKeys(entries);
  return entries.map((entry, index) => [keys[index] ?? "", entry] as const);
}

function DayChangeRow({
  entry,
  day = "today",
  muted = false,
}: {
  readonly entry: DayChange;
  /** Der Tag der Sätze; „erledigt“ gibt es nur heute. */
  readonly day?: DayChangesDay;
  /** Erledigt: grau, damit das Aktuelle vorne bleibt. */
  readonly muted?: boolean;
}) {
  if (entry.childSummary) {
    return (
      <ChildSummaryRow entry={entry} summary={entry.childSummary} day={day} />
    );
  }
  return <DayChangeLinkRow entry={entry} day={day} muted={muted} />;
}

/**
 * Die Kinder einer Gruppe oder Klasse außerhalb der eigenen Gruppen (#7665):
 * eine Zeile mit den Zahlen, die die Kinder einzeln aufklappt. So erschlägt
 * ein Grippetag nicht mit dreißig Zeilen.
 */
function ChildSummaryRow({
  entry,
  summary,
  day,
}: {
  readonly entry: DayChange;
  readonly summary: NonNullable<DayChange["childSummary"]>;
  readonly day: DayChangesDay;
}) {
  const hrefOf = useDayChangeHref();
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="overflow-hidden rounded-xl">
      <ListGroupHeader
        as="h4"
        title={childSummaryTitle(entry)}
        addon={
          <span className="text-xs text-gray-600">
            {childSummaryCounts(summary)}
          </span>
        }
        collapsible={{
          expanded,
          onToggle: () => setExpanded((open) => !open),
        }}
      />
      {expanded ? (
        <ul className="mt-1 space-y-1">
          {summary.items.map((item) => {
            const text = childChangeText(item.kind, item.child, day);
            if (!text) return null;
            const href = hrefOf(item.link, day);
            const body = (
              <span className="block min-w-0 flex-1 text-sm text-gray-900">
                {text}
              </span>
            );
            return (
              <li
                key={`${item.kind}:${item.child.studentId}`}
                onClickCapture={
                  href ? () => trackEntryClick(item.kind) : undefined
                }
              >
                {href ? (
                  <ListRow href={href} density="compact">
                    {body}
                  </ListRow>
                ) : (
                  <ListRow density="compact">{body}</ListRow>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

function DayChangeLinkRow({
  entry,
  day,
  muted = false,
}: {
  readonly entry: DayChange;
  readonly day: DayChangesDay;
  readonly muted?: boolean;
}) {
  const hrefOf = useDayChangeHref();
  const text = dayChangeText(entry, day) ?? "";
  const span = dayChangeSpan(entry);
  const href = hrefOf(entry.link, day);
  // Zeitraum und Ort stehen bei jeder Zeile an derselben Stelle: hinter dem
  // Satz, kleiner und grau. Eine lange Änderung, die vor heute begann
  // („… · seit 3.11.“), ist ganz grau, damit sie die neuen nicht verdrängt.
  const textClass =
    muted || entry.since !== null ? "text-gray-600" : "text-gray-900";
  const body = (
    <span className="min-w-0 flex-1 text-sm">
      <span className={textClass}>{text}</span>
      {span ? (
        <>
          {/* Das Leerzeichen bleibt im Namen des Links, der Punkt nicht. Der
              Zeitraum bricht als Ganzes um, nie mitten in der Uhrzeit; am
              Telefon steht er in seiner eigenen Zeile, ohne den Punkt. */}{" "}
          <span className="inline-block text-xs text-gray-500 max-sm:block">
            <span aria-hidden="true" className="max-sm:hidden">
              ·{" "}
            </span>
            {span}
          </span>
        </>
      ) : null}
    </span>
  );
  return (
    <li
      // Der Klick auf den Link der Zeile, mit Maus oder Tastatur (Enter löst
      // ihn ebenfalls aus). Nur die Art des Eintrags, nie Namen oder IDs.
      onClickCapture={href ? () => trackEntryClick(entry.kind) : undefined}
    >
      {href ? (
        <ListRow href={href} density="compact">
          {body}
        </ListRow>
      ) : (
        <ListRow density="compact">{body}</ListRow>
      )}
    </li>
  );
}
