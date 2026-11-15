// Header bell for staff reminders (issue #1457) and the notification feed
// (#7148). Always visible in the topbar (desktop + mobile) so the count is
// instantly seen. Two sections: Erinnerungen on top (only while the school
// has a reminder type switched on), the feed („Hinweise") below. The badge
// counts unread Hinweise plus active Erinnerungen and shows „9+" from 10.
// Opening the bell marks nothing as read; a Hinweis is read by its click or
// „Alle als gelesen markieren". Below `sm` the panel is a full-screen sheet.

"use client";

import dynamic from "next/dynamic";
import { Bell, X } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";

import { AnchoredPopover } from "~/components/ui/anchored-popover";
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
import { NotificationBadge } from "~/components/ui/notification-badge";
import { trackTenantEvent } from "~/lib/analytics";
import { BELOW_SM, useMediaQuery } from "~/lib/hooks/use-media-query";
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

// The badge sits on a 20-px icon: two digits are the most it carries.
const BADGE_MAX = 9;

// The feed list, its hooks and the infinite scroll load only when the bell
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

export function RemindersBell() {
  const { reminders, count, enabled } = useReminders();
  const { unreadCount, setUnreadCount } = useNotificationFeedUnread();
  const isPhone = useMediaQuery(BELOW_SM);
  const schoolId = useTenantSafe()?.tenant?.tenantId?.toString() ?? null;
  const [isOpen, setIsOpen] = useState(false);
  const phoneTriggerRef = useRef<HTMLButtonElement>(null);
  const phonePanelId = useId();

  const reminderCount = enabled ? count : 0;
  const badgeCount = unreadCount + reminderCount;

  const changeOpen = useCallback(
    (next: boolean) => {
      if (next && !isOpen && schoolId) {
        trackTenantEvent("notification_bell_opened", schoolId);
      }
      setIsOpen(next);
    },
    [isOpen, schoolId],
  );
  const close = useCallback(() => setIsOpen(false), []);

  const content = (
    <div className="divide-y divide-gray-100">
      {/* Hidden while the school has no reminder type switched on. */}
      {enabled ? (
        <RemindersSection
          reminders={reminders}
          count={count}
          onNavigate={close}
        />
      ) : null}
      <NotificationFeedSection
        schoolId={schoolId}
        unreadCount={unreadCount}
        onUnreadCount={setUnreadCount}
        onNavigate={close}
      />
    </div>
  );

  const renderTrigger = ({
    ref,
    toggle,
    panelId,
  }: {
    ref: React.Ref<HTMLButtonElement>;
    toggle: () => void;
    panelId: string;
  }) => (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={
        badgeCount > 0
          ? `Benachrichtigungen (${badgeCount})`
          : "Benachrichtigungen"
      }
      aria-expanded={isOpen}
      aria-haspopup="dialog"
      aria-controls={isOpen ? panelId : undefined}
      tooltip="Zeigt Erinnerungen und Hinweise, ohne die Seite zu verlassen."
      className="relative"
    >
      <Bell className="h-5 w-5" />
      <NotificationBadge
        count={badgeCount}
        tone="red"
        size="sm"
        max={BADGE_MAX}
        ariaLabel={`${badgeCount} Benachrichtigungen`}
        className="absolute -top-0.5 -right-0.5"
      />
    </Button>
  );

  if (isPhone) {
    const closeSheet = () => {
      setIsOpen(false);
      phoneTriggerRef.current?.focus();
    };
    return (
      <>
        {renderTrigger({
          ref: phoneTriggerRef,
          toggle: () => changeOpen(!isOpen),
          panelId: phonePanelId,
        })}
        <Drawer
          open={isOpen}
          onOpenChange={(next) => {
            changeOpen(next);
            if (!next) phoneTriggerRef.current?.focus();
          }}
        >
          <DrawerContent
            id={phonePanelId}
            fullScreen
            data-testid="notification-sheet"
          >
            <div className="flex items-center justify-between gap-2 px-4 pt-2 pb-3">
              <DrawerTitle>Benachrichtigungen</DrawerTitle>
              <DrawerDescription className="sr-only">
                Erinnerungen und Hinweise für Sie.
              </DrawerDescription>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={closeSheet}
                aria-label="Schließen"
                tooltip="Schließt die Benachrichtigungen."
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto overscroll-contain border-t border-gray-100">
              {content}
            </div>
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  return (
    <AnchoredPopover
      open={isOpen}
      onOpenChange={changeOpen}
      ariaLabel="Benachrichtigungen"
      preferredWidth={360}
      align="end"
      focusPanelOnOpen
      header={<p className="font-semibold text-gray-900">Benachrichtigungen</p>}
      renderTrigger={renderTrigger}
    >
      {() => content}
    </AnchoredPopover>
  );
}
