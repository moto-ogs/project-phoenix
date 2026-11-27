// Header-Hinweis „Neu für dich“: Notizen, die das Team geteilt hat (#6854),
// und geänderte Abholzeiten von Kindern, für die die Person zuständig ist
// (#6855). Er erscheint nur, solange etwas ungelesen ist. Der rote Zähler
// verschwindet, sobald die Person das Kind öffnet.

"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, Newspaper, StickyNote } from "lucide-react";
import { AnchoredPopover } from "~/components/ui/anchored-popover";
import { Button } from "~/components/ui/button";
import { ListRowLink } from "~/components/ui/list-row-link";
import { NotificationBadge } from "~/components/ui/notification-badge";
import { formatChatTime } from "~/lib/date-helpers";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { usePickupChangeNotices } from "~/lib/hooks/use-pickup-change-notices";
import { pickupDayLabel } from "~/lib/pickup-day-label";
import { useStudentNoteTeamNotices } from "~/lib/hooks/use-student-note-team-notices";
import type { PickupChangeNotice } from "~/lib/pickup-change-notices-api";
import type { StudentNoteTeamNotice } from "~/lib/student-notes-api";
import { useTenantAwarePath } from "~/lib/tenant-path";

export const STAFF_NEWS_TITLE = "Neu für dich";

export type StaffNewsItem =
  | { readonly kind: "note"; readonly notice: StudentNoteTeamNotice }
  | { readonly kind: "pickup"; readonly notice: PickupChangeNotice };

/** Both kinds in one list, newest first. */
export function staffNewsItems(
  notes: readonly StudentNoteTeamNotice[],
  pickups: readonly PickupChangeNotice[],
): StaffNewsItem[] {
  const items: StaffNewsItem[] = [
    ...notes.map((notice) => ({ kind: "note" as const, notice })),
    ...pickups.map((notice) => ({ kind: "pickup" as const, notice })),
  ];
  return items.sort((a, b) =>
    b.notice.informedAt.localeCompare(a.notice.informedAt),
  );
}

/** The unread notes and pickup changes of the reader, merged. */
export function useStaffNews(): StaffNewsItem[] {
  const { notices: notes } = useStudentNoteTeamNotices();
  const { notices: pickups } = usePickupChangeNotices();
  return useMemo(() => staffNewsItems(notes, pickups), [notes, pickups]);
}

function noteSubtitle(notice: StudentNoteTeamNotice): string {
  const when = formatChatTime(notice.informedAt);
  return notice.authorName
    ? `Notiz von ${notice.authorName}, ${when}`
    : `Notiz, ${when}`;
}

/**
 * „Morgen: neue Abholzeit 15:00 Uhr“, „Morgen: Tante Frieda holt ab“ (#8162)
 * „Morgen: Tante Frieda holt ab“, „Fr, 20.11.2026: Abholperson
 * zurückgenommen“ or „Fr, 20.11.2026: wieder normale Abholzeit“.
 */
function pickupSubtitle(notice: PickupChangeNotice, today: string): string {
  const day = pickupDayLabel(notice.date, today);
  if (notice.withdrawn && notice.pickupPerson && notice.pickupTime) {
    return `${day}: Abholzeit und Abholperson zurückgenommen`;
  }
  if (notice.withdrawn && notice.pickupPerson) {
    return `${day}: Abholperson zurückgenommen`;
  }
  if (notice.withdrawn) return `${day}: wieder normale Abholzeit`;
  const parts = [
    notice.pickupTime ? `neue Abholzeit ${notice.pickupTime} Uhr` : "",
    notice.pickupPerson ? `${notice.pickupPerson} holt ab` : "",
  ].filter(Boolean);
  return `${day}: ${parts.join(", ")}`;
}

function itemKey(item: StaffNewsItem): string {
  return item.kind === "note"
    ? `note-${item.notice.noteId}`
    : `pickup-${item.notice.requestId}`;
}

/**
 * Die ungelesenen Hinweise als Zeilen: im Popover der Kopfzeile und unter
 * 1024 px im Menü „Mehr“, wo es keine Kopfzeile gibt. Eine Notiz öffnet die
 * Notizen des Kindes, eine Abholzeit das Kind; dort gilt sie als gelesen.
 */
export function StaffNewsList({
  items,
  onNavigate,
  rows = false,
}: {
  readonly items: readonly StaffNewsItem[];
  readonly onNavigate?: () => void;
  /**
   * Nur die Zeilen (`<li>`) mit Symbol, für eine Liste, in der jede Zeile
   * ein Symbol trägt (Seite „Mehr“ der App, #8070). Ohne: eigene Liste.
   */
  readonly rows?: boolean;
}) {
  const tenantPath = useTenantAwarePath();
  const today = useBerlinToday();
  const icon = (Glyph: typeof Clock) =>
    rows ? (
      <Glyph className="h-5 w-5 shrink-0 text-gray-600" aria-hidden="true" />
    ) : undefined;
  const lines = items.map((item) => {
    const studentPath = `/students/${encodeURIComponent(item.notice.studentId)}`;
    return (
      <li key={itemKey(item)}>
        {item.kind === "note" ? (
          <ListRowLink
            href={tenantPath(`${studentPath}?tab=notizen`)}
            icon={icon(StickyNote)}
            title={`${item.notice.studentFirstName} ${item.notice.studentLastName}`}
            subtitle={noteSubtitle(item.notice)}
            unread
          />
        ) : (
          <ListRowLink
            href={tenantPath(studentPath)}
            icon={icon(Clock)}
            title={item.notice.studentFirstName}
            subtitle={pickupSubtitle(item.notice, today)}
            unread
          />
        )}
      </li>
    );
  });
  if (rows) return <>{lines}</>;
  return (
    // Schließt das Menü, wenn eine Zeile den Seitenwechsel startet.
    <ul className="divide-y divide-gray-100" onClickCapture={onNavigate}>
      {lines}
    </ul>
  );
}

export function StaffNewsButton() {
  const items = useStaffNews();
  const [isOpen, setIsOpen] = useState(false);
  const count = items.length;
  // Öffnet die Person ein Kind, gilt der Hinweis als gelesen; die Liste wird
  // kürzer, und das Fenster schließt sich.
  useEffect(() => {
    setIsOpen(false);
  }, [count]);

  // Nichts zu lesen, nichts zu zeigen: ein Knopf ohne Inhalt wäre eine
  // Sackgasse.
  if (count === 0) return null;

  return (
    <AnchoredPopover
      open={isOpen}
      onOpenChange={setIsOpen}
      ariaLabel={STAFF_NEWS_TITLE}
      preferredWidth={320}
      align="end"
      focusPanelOnOpen
      header={<p className="font-semibold text-gray-900">{STAFF_NEWS_TITLE}</p>}
      renderTrigger={({ ref, toggle, panelId }) => (
        <Button
          ref={ref}
          type="button"
          variant="ghost"
          size="icon"
          onClick={toggle}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          aria-controls={isOpen ? panelId : undefined}
          tooltip="Zeigt neue Notizen vom Team und geänderte Abholzeiten."
          className="relative"
        >
          {/* Name from content: the visible count stays part of it (WCAG
              2.5.3, #7112). */}
          <span className="sr-only">{STAFF_NEWS_TITLE}</span>
          <Newspaper className="h-5 w-5" aria-hidden="true" />
          <NotificationBadge
            count={count}
            tone="red"
            size="sm"
            ariaLabel={`${count} ungelesen`}
            className="absolute -top-0.5 -right-0.5"
          />
        </Button>
      )}
    >
      {() => <StaffNewsList items={items} />}
    </AnchoredPopover>
  );
}
