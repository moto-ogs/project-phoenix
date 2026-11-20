"use client";

import { useId, useRef, useState } from "react";
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
import { BELOW_SM, useMediaQuery } from "~/lib/hooks/use-media-query";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { homeKeys } from "~/lib/swr/portal-keys";
import { useTenantAwarePath } from "~/lib/tenant-path";

/** So viele Einträge von „Schule“ zeigt das Telefon, bevor es zählt. */
const PHONE_SCHOOL_ROWS = 3;

/**
 * Baustein „Heute anders“ (#7659): was heute anders läuft als geplant, zuerst
 * was die Person selbst betrifft, darunter die übrige Schule. Jeder Eintrag
 * führt zur Detailseite. Ein Ereignis, das eine Quelle ändert, lädt den
 * Baustein neu (`useGlobalSSE`). Ist eine Quelle ausgefallen, steht ein
 * Hinweis da und nie die Entwarnung.
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

function DayChangesContent({
  overview,
}: {
  readonly overview: DayChangesOverview;
}) {
  const shown = overview.entries.filter(
    (entry) => dayChangeText(entry) !== null,
  );
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
      {/* Ein Bildschirmleser hört, wenn sich die Zahl der Einträge ändert. */}
      <p className="sr-only" aria-live="polite">
        {shown.length === 1
          ? "1 Änderung heute"
          : `${shown.length} Änderungen heute`}
      </p>
      <div
        className={
          mine.length > 0 && school.length > 0
            ? "grid gap-4 lg:grid-cols-2"
            : "grid gap-4"
        }
      >
        {mine.length > 0 ? (
          <DayChangesSection title="Betrifft dich" entries={mine} />
        ) : null}
        {school.length > 0 ? (
          <DayChangesSection title="Schule" entries={school} capOnPhone />
        ) : null}
      </div>
    </div>
  );
}

function DayChangesSection({
  title,
  entries,
  capOnPhone = false,
}: {
  readonly title: string;
  readonly entries: readonly DayChange[];
  /** Auf dem Telefon nur die ersten Einträge, damit „Mein Tag“ sichtbar bleibt. */
  readonly capOnPhone?: boolean;
}) {
  const isPhone = useMediaQuery(BELOW_SM);
  const [expanded, setExpanded] = useState(false);
  const headingId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const capped = capOnPhone && isPhone && !expanded;
  const visible = capped ? entries.slice(0, PHONE_SCHOOL_ROWS) : entries;

  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <SectionLabel id={headingId} as="h3" className="mb-2">
        {title}
      </SectionLabel>
      <ul ref={listRef} className="space-y-2">
        {visible.map((entry, index) => (
          <DayChangeRow key={dayChangeKey(entry, index)} entry={entry} />
        ))}
      </ul>
      {capped && entries.length > PHONE_SCHOOL_ROWS ? (
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
          Alle anzeigen ({entries.length})
        </Button>
      ) : null}
    </section>
  );
}

/** Stabil über ein Neuladen hinweg: Art, Personen und Gruppe. */
function dayChangeKey(entry: DayChange, index: number): string {
  const people = entry.people.map((person) => person.staffId).join(",");
  return `${entry.kind}:${people}:${entry.groupName ?? ""}:${entry.startsAt ?? ""}:${people || entry.groupName ? "" : index}`;
}

function DayChangeRow({ entry }: { readonly entry: DayChange }) {
  const tenantPath = useTenantAwarePath();
  const text = dayChangeText(entry) ?? "";
  const span = dayChangeSpan(entry);
  const href = dayChangeHref(entry);
  const body = (
    <span className="min-w-0 flex-1">
      <span className="block text-sm text-gray-900">{text}</span>
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
