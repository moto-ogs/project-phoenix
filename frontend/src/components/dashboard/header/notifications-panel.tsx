"use client";

// Inhalt der Glocke (#1457, #7148) und das Vollbild-Blatt fürs Telefon. Zwei
// Wege öffnen dasselbe Blatt: die Glocke in der Kopfzeile und die Zeile
// „Benachrichtigungen“ im Menü „Mehr“ (unter 1024 px fehlt die Kopfzeile).
// Der Offen-Zustand liegt deshalb in einem kleinen Speicher dieses Moduls,
// das Blatt rendert genau ein Ort (die untere Leiste, `NotificationsSheet`).

import dynamic from "next/dynamic";
import { X } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";

import { Button, ButtonLink } from "~/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "~/components/ui/drawer";
import { EmptyState } from "~/components/ui/empty-state";
import { ListGroupHeader } from "~/components/ui/list-group-header";
import { Loading } from "~/components/ui/loading";
import { trackTenantEvent } from "~/lib/analytics";
import { useNotificationFeedUnread } from "~/lib/hooks/use-notification-feed";
import { useReminders } from "~/lib/hooks/use-reminders";
import type { Reminder } from "~/lib/reminders-api";
import {
  reminderKey,
  reminderRelativeLabel,
  reminderSubtitle,
  reminderToneClass,
} from "~/lib/reminders-display";
import { useTenantSafe } from "~/lib/tenant-context";
import { useTenantAwarePath } from "~/lib/tenant-path";

// How many reminders to preview inline before linking out to the full page.
const PREVIEW_LIMIT = 5;

/** Abzeichen an Glocke und „Mehr“: zwei Ziffern sind das Höchste, „9+“. */
export const NOTIFICATIONS_BADGE_MAX = 9;

// The feed list, its hooks and the infinite scroll load only when the panel
// opens: the bell itself is mounted on every staff page.
const NotificationFeedSection = dynamic(
  () =>
    import("./notification-feed-section").then(
      (module) => module.NotificationFeedSection,
    ),
  {
    ssr: false,
    loading: () => <Loading compact message="Hinweise werden geladen." />,
  },
);

// --- Offen-Zustand des Blatts ------------------------------------------------

let sheetOpen = false;
const listeners = new Set<() => void>();

function setSheetOpen(next: boolean) {
  if (sheetOpen === next) return;
  sheetOpen = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const readOpen = () => sheetOpen;
const readServer = () => false;

/** Ob das Vollbild-Blatt offen ist, für `aria-expanded` an den Auslösern. */
export function useNotificationsSheetOpen(): boolean {
  return useSyncExternalStore(subscribe, readOpen, readServer);
}

/** Die Schule der Sitzung für die Nutzungsanalyse; null ohne Schule. */
export function useAnalyticsSchoolId(): string | null {
  return useTenantSafe()?.tenant?.tenantId?.toString() ?? null;
}

/**
 * Öffnet das Blatt und zählt das Öffnen der Glocke, von welchem Auslöser
 * auch immer (`notification_bell_opened`, ohne Inhalte).
 */
export function useOpenNotificationsSheet(): () => void {
  const schoolId = useAnalyticsSchoolId();
  return useCallback(() => {
    if (!sheetOpen && schoolId) {
      trackTenantEvent("notification_bell_opened", schoolId);
    }
    setSheetOpen(true);
  }, [schoolId]);
}

export function closeNotificationsSheet() {
  setSheetOpen(false);
}

// --- Inhalt -----------------------------------------------------------------

function BellRow({ reminder }: { readonly reminder: Reminder }) {
  const subtitle = reminderSubtitle(reminder);
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-gray-900">
          {reminder.title}
        </p>
        {subtitle && (
          <p className="truncate text-xs text-gray-500">{subtitle}</p>
        )}
      </div>
      <div className="flex flex-shrink-0 flex-col items-end">
        <span className="text-xs font-semibold text-gray-900">
          {reminder.due_time}
        </span>
        <span className={`text-xs ${reminderToneClass(reminder)}`}>
          {reminderRelativeLabel(reminder)}
        </span>
      </div>
    </li>
  );
}

function RemindersSection({
  reminders,
  count,
  onNavigate,
}: Readonly<{
  reminders: readonly Reminder[];
  count: number;
  onNavigate: () => void;
}>) {
  const tenantPath = useTenantAwarePath();
  const preview = reminders.slice(0, PREVIEW_LIMIT);
  const overflow = count - preview.length;
  return (
    <section aria-label="Erinnerungen">
      <ListGroupHeader
        title="Erinnerungen"
        meta={
          <ButtonLink
            href={tenantPath("/reminders")}
            onClick={onNavigate}
            variant="link"
            size="compact"
            tooltip="Öffnet die Seite mit allen Erinnerungen."
          >
            Alle ansehen
          </ButtonLink>
        }
      />
      {count === 0 ? (
        <EmptyState
          variant="compact"
          title="Keine aktiven Erinnerungen."
          className="px-4 py-4"
        />
      ) : (
        <>
          <ul className="divide-y divide-gray-100">
            {preview.map((reminder) => (
              <BellRow key={reminderKey(reminder)} reminder={reminder} />
            ))}
          </ul>
          {overflow > 0 && (
            <p className="px-4 py-2 text-center text-xs text-gray-500">
              +{overflow} weitere
            </p>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Erinnerungen oben (nur, solange die Schule eine Erinnerungsart nutzt),
 * darunter die Hinweise. Derselbe Inhalt im Rahmen am Desktop und im Blatt.
 */
export function NotificationsPanelContent({
  onNavigate,
}: Readonly<{ onNavigate: () => void }>) {
  const { reminders, count, enabled } = useReminders();
  const { unreadCount, setUnreadCount } = useNotificationFeedUnread();
  const schoolId = useAnalyticsSchoolId();
  return (
    <div className="divide-y divide-gray-100">
      {enabled ? (
        <RemindersSection
          reminders={reminders}
          count={count}
          onNavigate={onNavigate}
        />
      ) : null}
      <NotificationFeedSection
        schoolId={schoolId}
        unreadCount={unreadCount}
        onUnreadCount={setUnreadCount}
        onNavigate={onNavigate}
      />
    </div>
  );
}

/**
 * Das Blatt über den ganzen Telefonbildschirm. Einmal gerendert (untere
 * Leiste des Staff-Portals); Glocke und Menüzeile öffnen es über
 * `useOpenNotificationsSheet`.
 */
export function NotificationsSheet() {
  const open = useNotificationsSheetOpen();
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) closeNotificationsSheet();
      }}
    >
      <DrawerContent fullScreen data-testid="notification-sheet">
        <div className="flex items-center justify-between gap-2 px-4 pt-2 pb-3">
          <DrawerTitle>Benachrichtigungen</DrawerTitle>
          <DrawerDescription className="sr-only">
            Erinnerungen und Hinweise für Sie.
          </DrawerDescription>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={closeNotificationsSheet}
            aria-label="Schließen"
            tooltip="Schließt die Benachrichtigungen."
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto overscroll-contain border-t border-gray-100">
          {open ? (
            <NotificationsPanelContent onNavigate={closeNotificationsSheet} />
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
