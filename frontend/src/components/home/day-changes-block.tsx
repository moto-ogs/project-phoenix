"use client";

import { useId, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useSession } from "next-auth/react";

import {
  HomeCard,
  HomeCardEmpty,
  HomeCardIcon,
} from "~/components/home/home-card";
import {
  dayChangeHref,
  dayChangeSpan,
  dayChangeText,
  sourceFailureText,
} from "~/components/home/day-changes-text";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
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
import { BELOW_SM, useMediaQuery } from "~/lib/hooks/use-media-query";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { homeKeys } from "~/lib/swr/portal-keys";
import { useTenantAwarePath } from "~/lib/tenant-path";
import { cn } from "~/lib/utils";

/** So viele Einträge von „Schule“ zeigt das Telefon, bevor es zählt. */
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
 * Die Karte wächst mit ihrem Inhalt (`data-home-card-fit`): eine Übersicht,
 * die bei vielen Einträgen die Hälfte abschneidet, wäre keine.
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
          return <DayChangesContent overview={data} />;
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
  const keys = overview ? shownEntries(overview).map(dayChangeKey) : null;
  const signature = keys?.join("|") ?? null;
  const [last, setLast] = useState<{
    keys: readonly string[] | null;
    signature: string | null;
    message: string;
  }>({ keys: null, signature: null, message: "" });
  if (keys && signature !== last.signature) {
    // Abgeleiteter Zustand während des Renderns statt eines Effekts.
    setLast({
      keys,
      signature,
      message: last.keys ? changeMessage(last.keys, keys) : "",
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
}: {
  readonly overview: DayChangesOverview;
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
          <DayChangesSection title="Betrifft dich" entries={mine} now={now} />
        ) : null}
        {school.length > 0 ? (
          <DayChangesSection
            title="Schule"
            entries={school}
            now={now}
            capOnPhone
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
  capOnPhone = false,
}: {
  readonly title: string;
  readonly entries: readonly DayChange[];
  /** Die Uhr des Browsers in Minuten-Schritten; 0 vor dem ersten Rendern. */
  readonly now: number;
  /** Auf dem Telefon nur die ersten Einträge, damit „Mein Tag“ sichtbar bleibt. */
  readonly capOnPhone?: boolean;
}) {
  const isPhone = useMediaQuery(BELOW_SM);
  const [expanded, setExpanded] = useState(false);
  const headingId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const open = entries.filter((entry) => !isDone(entry, now));
  const done = entries.filter((entry) => isDone(entry, now));
  const capped =
    capOnPhone && isPhone && !expanded && open.length > PHONE_SCHOOL_ROWS;
  const visible = capped ? open.slice(0, PHONE_SCHOOL_ROWS) : open;

  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <SectionLabel id={headingId} as="h3" className="mb-2">
        {title}
      </SectionLabel>
      {visible.length > 0 ? (
        <ul ref={listRef} className="space-y-2">
          {visible.map((entry) => (
            <DayChangeRow key={dayChangeKey(entry)} entry={entry} />
          ))}
        </ul>
      ) : null}
      {capped ? (
        <Button
          type="button"
          variant="link"
          className="mt-2"
          aria-expanded={false}
          tooltip="Zeigt alle Änderungen der Schule von heute."
          onClick={() => {
            setExpanded(true);
            trackEvent("day_changes_show_all");
            // Der Knopf verschwindet; der Fokus geht auf den ersten neuen
            // Eintrag statt an den Seitenanfang.
            requestAnimationFrame(() => {
              const rows = listRef.current?.querySelectorAll<HTMLElement>(
                ":scope > li > a, :scope > li > div",
              );
              rows?.[PHONE_SCHOOL_ROWS]?.focus();
            });
          }}
        >
          Alle anzeigen ({open.length})
        </Button>
      ) : null}
      {done.length > 0 ? <DoneChanges entries={done} /> : null}
    </section>
  );
}

/** „3 erledigt“: was heute schon vorbei ist, eingeklappt am Ende. */
function DoneChanges({ entries }: { readonly entries: readonly DayChange[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <div className="mt-2">
      <Button
        type="button"
        variant="ghost"
        size="compact"
        className="-ml-2"
        aria-expanded={open}
        aria-controls={listId}
        tooltip={
          open
            ? "Blendet die Änderungen aus, die heute schon vorbei sind."
            : "Zeigt die Änderungen, die heute schon vorbei sind."
        }
        onClick={() => {
          if (!open) trackEvent("day_changes_done_expanded");
          setOpen(!open);
        }}
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform",
            open && "rotate-90",
          )}
        />
        {entries.length} erledigt
      </Button>
      <ul id={listId} hidden={!open} className="mt-1 space-y-2">
        {open
          ? entries.map((entry) => (
              <DayChangeRow key={dayChangeKey(entry)} entry={entry} muted />
            ))
          : null}
      </ul>
    </div>
  );
}

/**
 * Stabil über ein Neuladen hinweg: Art, Personen, Gruppe und Beginn. Eine
 * Zusammenfassung trägt nur ihre Art, ihre Zahl ändert den Schlüssel nicht.
 */
function dayChangeKey(entry: DayChange): string {
  const people = entry.people.map((person) => person.staffId).join(",");
  return `${entry.section}:${entry.kind}:${people}:${entry.groupName ?? ""}:${entry.startsAt ?? ""}`;
}

function DayChangeRow({
  entry,
  muted = false,
}: {
  readonly entry: DayChange;
  /** Erledigt: grau, damit das Aktuelle vorne bleibt. */
  readonly muted?: boolean;
}) {
  const tenantPath = useTenantAwarePath();
  const text = dayChangeText(entry) ?? "";
  const span = dayChangeSpan(entry);
  const href = dayChangeHref(entry);
  // Eine lange Änderung, die vor heute begann, steht kompakt in einer Zeile
  // („… · seit 3.11.“), damit sie nicht jeden Tag die neuen verdrängt.
  const compact = entry.since !== null;
  const textClass = muted || compact ? "text-gray-600" : "text-gray-900";
  const body = compact ? (
    <span className="min-w-0 flex-1 text-sm">
      <span className={textClass}>{text}</span>
      {span ? (
        <span className="text-xs text-gray-500">
          <span aria-hidden="true"> · </span>
          <span>{span}</span>
        </span>
      ) : null}
    </span>
  ) : (
    <span className="min-w-0 flex-1">
      <span className={cn("block text-sm", textClass)}>{text}</span>
      {span ? (
        <span className="block text-xs text-gray-500">{span}</span>
      ) : null}
    </span>
  );
  return (
    <li
      // Der Klick auf den Link der Zeile, mit Maus oder Tastatur (Enter löst
      // ihn ebenfalls aus). Nur die Art des Eintrags, nie Namen oder IDs.
      onClickCapture={
        href
          ? () =>
              trackEvent("day_changes_entry_clicked", {
                day_change_kind: entry.kind,
              })
          : undefined
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
}
