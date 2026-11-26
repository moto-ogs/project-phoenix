"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
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
  dayChangeHref,
  dayChangeLinkHref,
  dayChangeSpan,
  dayChangeText,
  sourceFailureText,
} from "~/components/home/day-changes-text";
import { DayNoticeRow } from "~/components/home/day-notice-row";
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
import { useCurrentTimestamp } from "~/lib/hooks/use-current-timestamp";
import { useDayPlanHref } from "~/lib/hooks/use-day-plan-href";
import { BELOW_SM, useMediaQuery } from "~/lib/hooks/use-media-query";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { homeKeys } from "~/lib/swr/portal-keys";
import { useTenantAwarePath } from "~/lib/tenant-path";
import { cn } from "~/lib/utils";

/**
 * So viele offene Einträge von „Schule“ stehen da, bevor die Karte zählt:
 * fünf wie in jeder langen Liste des Kits, am Telefon drei, damit „Mein Tag“
 * sichtbar bleibt.
 */
const SCHOOL_ROWS = 5;
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
  const { data, error, isLoading, mutate } = useSWRAuth<DayChangesOverview>(
    homeKeys.dayChanges(accountId),
    fetchDayChanges,
    // Abgleich beim Fokus des Fensters (#7659), zusätzlich zu den
    // SSE-Ereignissen und dem Abgleich nach erneuter Verbindung.
    { revalidateOnFocus: true },
  );
  const loadError = useSwrLoadError(error, "die Übersicht „Heute anders“", () =>
    mutate(),
  );

  return (
    <HomeCard
      title="Heute anders"
      leading={<HomeCardIcon concept={dayChangesConcept} />}
    >
      <div data-home-card-fit="">
        {(() => {
          if (loadError) return <LoadErrorAlert error={loadError} />;
          if (!data) {
            return isLoading || error ? <DayChangesSkeleton /> : null;
          }
          return <DayChangesContent overview={data} onChanged={mutate} />;
        })()}
      </div>
      <DayChangesAnnouncer overview={data} />
    </HomeCard>
  );
}

function DayChangesSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      <Skeleton className="h-4 w-2/5" />
      <Skeleton className="h-3 w-4/5" />
      <Skeleton className="h-3 w-3/5" />
    </div>
  );
}

/** Was die Übersicht zeigt: nur Arten, für die das Frontend einen Satz hat. */
function shownEntries(overview: DayChangesOverview): DayChange[] {
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
  onChanged,
}: {
  readonly overview: DayChangesOverview;
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
    return <HomeCardEmpty title="Heute läuft alles wie geplant." />;
  }
  return (
    <div className="space-y-4">
      {failures.length > 0 ? <div className="space-y-2">{failures}</div> : null}
      <div
        className={
          mine.length > 0 && school.length > 0
            ? "grid gap-4 lg:grid-cols-2"
            : "grid gap-4"
        }
      >
        {mine.length > 0 ? (
          <DayChangesSection
            title="Betrifft dich"
            entries={mine}
            now={now}
            onChanged={onChanged}
          />
        ) : null}
        {school.length > 0 ? (
          <DayChangesSection
            title="Schule"
            entries={school}
            now={now}
            onChanged={onChanged}
            folds
          />
        ) : null}
      </div>
    </div>
  );
}

function DayChangesSection({
  title,
  entries,
  now,
  onChanged,
  folds = false,
}: {
  readonly title: string;
  readonly entries: readonly DayChange[];
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
        <ul id={listId} className="space-y-2">
          {withKeys(visible).map(([key, entry]) =>
            entry.notice ? (
              <DayNoticeRow
                key={key}
                entry={entry}
                notice={entry.notice}
                onChanged={onChanged}
              />
            ) : (
              <DayChangeRow key={key} entry={entry} />
            ),
          )}
        </ul>
      ) : null}
      <div className="mt-2 empty:hidden">
        {hidden > 0 ? (
          // Der Knopf bleibt nach dem Aufklappen stehen und trägt den Fokus:
          // wer alles gesehen hat, klappt an derselben Stelle wieder zu.
          <FoldButton
            expanded={expanded}
            controls={listId}
            tooltip={
              expanded
                ? "Zeigt wieder nur die ersten Änderungen der Schule."
                : "Zeigt alle Änderungen der Schule von heute."
            }
            onToggle={() => {
              if (!expanded) trackEvent("day_changes_show_all");
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
 * Die Klappe am Ende eines Abschnitts: „15 weitere anzeigen“ und „3 erledigt“
 * sehen gleich aus, weil beide dasselbe tun.
 */
function FoldButton({
  expanded,
  controls,
  tooltip,
  onToggle,
  children,
}: {
  readonly expanded: boolean;
  readonly controls: string;
  readonly tooltip: string;
  readonly onToggle: () => void;
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
        tooltip={tooltip}
        onClick={onToggle}
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform",
            expanded && "rotate-90",
          )}
        />
        {children}
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
      <ul id={listId} hidden={!open} className="mt-1 space-y-2">
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
  muted = false,
}: {
  readonly entry: DayChange;
  /** Erledigt: grau, damit das Aktuelle vorne bleibt. */
  readonly muted?: boolean;
}) {
  if (entry.childSummary) {
    return <ChildSummaryRow entry={entry} summary={entry.childSummary} />;
  }
  return <DayChangeLinkRow entry={entry} muted={muted} />;
}

/** Klick auf einen Eintrag: nur die Art, nie Namen oder IDs. */
function trackEntryClick(kind: string) {
  trackEvent("day_changes_entry_clicked", { day_change_kind: kind });
}

/**
 * Die Kinder einer Gruppe oder Klasse außerhalb der eigenen Gruppen (#7665):
 * eine Zeile mit den Zahlen, die die Kinder einzeln aufklappt. So erschlägt
 * ein Grippetag nicht mit dreißig Zeilen.
 */
function ChildSummaryRow({
  entry,
  summary,
}: {
  readonly entry: DayChange;
  readonly summary: NonNullable<DayChange["childSummary"]>;
}) {
  const tenantPath = useTenantAwarePath();
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
            const text = childChangeText(item.kind, item.child);
            if (!text) return null;
            const href = dayChangeLinkHref(item.link);
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
                  <ListRow href={tenantPath(href)} density="compact">
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
  muted = false,
}: {
  readonly entry: DayChange;
  readonly muted?: boolean;
}) {
  const tenantPath = useTenantAwarePath();
  const dayPlanHref = useDayPlanHref();
  const text = dayChangeText(entry) ?? "";
  const span = dayChangeSpan(entry);
  const path = dayChangeHref(entry);
  // Der Tagesplan heißt je Rolle anders (#7662): die Leitung ohne Gruppe
  // plant im Betreuungsplan.
  const href =
    path === null
      ? null
      : entry.link?.target === "day_plan"
        ? dayPlanHref
        : tenantPath(path);
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
              Zeitraum bricht als Ganzes um, nie mitten in der Uhrzeit. */}{" "}
          <span className="inline-block text-xs text-gray-500">
            <span aria-hidden="true">· </span>
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
