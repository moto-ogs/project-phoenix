"use client";

import type * as platformContract from "~/lib/contract/platform.generated";
import { useState, useCallback, useEffect, useRef } from "react";
import {
  SparkleIcon,
  MegaphoneIcon,
  WrenchIcon,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { Button } from "~/components/ui/button";
import { Modal } from "~/components/ui/modal";
import { MotoDuotoneIcon } from "~/components/ui/moto-duotone-icon";
import { useAnnouncements } from "~/lib/hooks/use-announcements";
import { trackOnboardingSurface } from "~/lib/analytics";
import { createLogger } from "~/lib/logger";
import { IconTile } from "~/components/ui/icon-tile";

const logger = createLogger({ component: "AnnouncementModal" });

// Contextual headers that create a positive, informative feeling
// title = small subtitle, subtitle = large main header
const DEFAULT_HEADER = {
  icon: MegaphoneIcon,
  title: "Neuigkeiten",
  subtitle: "Wichtige Informationen",
} as const;

const TYPE_HEADERS: Record<
  string,
  { icon: PhosphorIcon; title: string; subtitle: string }
> = {
  release: {
    icon: SparkleIcon,
    title: "Was ist neu?",
    subtitle: "Neue Funktionen und Verbesserungen",
  },
  announcement: DEFAULT_HEADER,
  maintenance: {
    icon: WrenchIcon,
    title: "Wartungshinweis",
    subtitle: "Geplante Systemarbeiten",
  },
};

export function AnnouncementModal() {
  const { announcements, dismiss, markSeen, isLoading, refresh } =
    useAnnouncements();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  // Keep a stable snapshot of announcements when modal opens
  const [queuedAnnouncements, setQueuedAnnouncements] = useState<
    platformContract.PlatformAnnouncementResponse[]
  >([]);
  const dismissedIdsRef = useRef<Set<string>>(new Set());
  // Track IDs closed in this session to avoid re-opening the modal.
  const closedIdsRef = useRef<Set<string>>(new Set());
  // Einstieg (#7555): a view report is attempted at most once per modal
  // instance. A transport failure can mean the backend committed it, so a
  // later render must not send it again.
  const seenAttemptedIdsRef = useRef<Set<string>>(new Set());
  const seenRequestsRef = useRef<Map<string, Promise<void>>>(new Map());
  const shownReportedRef = useRef(false);

  // Show modal when we have announcements - capture stable snapshot
  useEffect(() => {
    if (!isLoading && announcements.length > 0 && !isVisible) {
      // Filter out any we've already dismissed or closed in this session
      const unprocessed = announcements.filter(
        (a) =>
          !dismissedIdsRef.current.has(String(a.id)) &&
          !closedIdsRef.current.has(String(a.id)),
      );
      if (unprocessed.length > 0) {
        setQueuedAnnouncements(unprocessed);
        setCurrentIndex(0);
        setIsVisible(true);
      }
    }
  }, [announcements, isLoading, isVisible]);

  const reportSeen = useCallback(
    (id: string) => {
      const key = String(id);
      const existing = seenRequestsRef.current.get(key);
      if (existing) return existing;
      if (seenAttemptedIdsRef.current.has(key)) return Promise.resolve();

      seenAttemptedIdsRef.current.add(key);
      const request = Promise.resolve()
        .then(() => markSeen(id))
        .catch((error: unknown) => {
          logger.error("announcement_seen_failed", {
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        });
      seenRequestsRef.current.set(key, request);
      void request.then(
        () => {
          seenRequestsRef.current.delete(key);
        },
        () => undefined,
      );
      return request;
    },
    [markSeen],
  );

  const dismissAfterSeen = useCallback(
    (id: string) => {
      void reportSeen(id).then(
        () =>
          dismiss(id).catch((error: unknown) => {
            logger.error("announcement_dismiss_failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          }),
        () => undefined,
      );
    },
    [dismiss, reportSeen],
  );

  // Report each announcement once when it is on screen: the backend stores
  // seen_at and counts it for the school; the browser reports the surface.
  const currentId = isVisible
    ? queuedAnnouncements[currentIndex]?.id
    : undefined;
  useEffect(() => {
    if (!isVisible) {
      shownReportedRef.current = false;
      return;
    }
    if (!shownReportedRef.current) {
      shownReportedRef.current = true;
      trackOnboardingSurface("shown", "announcement");
    }
    if (currentId === undefined) return;
    void reportSeen(currentId).catch(() => undefined);
  }, [isVisible, currentId, reportSeen]);

  // Dismiss current and advance to next announcement ("Weiter" / "Verstanden")
  const handleDismiss = useCallback(async () => {
    const current = queuedAnnouncements[currentIndex];
    if (!current) return;

    // Track this ID as dismissed locally
    dismissedIdsRef.current.add(String(current.id));

    // Preserve the write order while the UI can already advance.
    dismissAfterSeen(current.id);

    // Move to next or close
    if (currentIndex < queuedAnnouncements.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      // "Verstanden" on the last one: the person took the announcement in.
      trackOnboardingSurface("accepted", "announcement");
      setIsVisible(false);
      // Refresh data after all announcements processed
      void refresh();
    }
  }, [queuedAnnouncements, currentIndex, dismissAfterSeen, refresh]);

  // Close modal entirely (X button, backdrop, Escape key)
  // Dismiss all queued announcements on the backend so they don't reappear on next login
  const handleClose = useCallback(() => {
    trackOnboardingSurface("dismissed", "announcement");
    const visibleID = queuedAnnouncements[currentIndex]?.id;
    for (const a of queuedAnnouncements) {
      closedIdsRef.current.add(String(a.id));
      if (!dismissedIdsRef.current.has(String(a.id))) {
        dismissedIdsRef.current.add(String(a.id));
        if (a.id === visibleID) {
          dismissAfterSeen(a.id);
          continue;
        }
        void dismiss(a.id).catch((error) => {
          logger.error("announcement_dismiss_failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }
    setIsVisible(false);
  }, [queuedAnnouncements, currentIndex, dismiss, dismissAfterSeen]);

  const current = queuedAnnouncements[currentIndex];
  if (!current || !isVisible) return null;

  const header = TYPE_HEADERS[current.type] ?? DEFAULT_HEADER;
  const totalCount = queuedAnnouncements.length;

  const footer = (
    <>
      <span className="flex-1 text-xs text-gray-500">
        {totalCount > 1 && `${currentIndex + 1} von ${totalCount}`}
      </span>
      <Button
        type="button"
        variant="success"
        size="md"
        onClick={() => void handleDismiss()}
        tooltip={
          currentIndex < totalCount - 1
            ? "Blendet diese Meldung aus und zeigt die nächste."
            : "Schließt die Meldung, sie erscheint danach nicht mehr."
        }
      >
        {currentIndex < totalCount - 1 ? "Weiter" : "Verstanden"}
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isVisible}
      onClose={handleClose}
      title={header.subtitle}
      icon={
        <IconTile icon={<MotoDuotoneIcon icon={header.icon} tone="amber" />} />
      }
      description={
        <>
          {header.title}
          {current.version && (
            <span className="ml-2 text-gray-500">v{current.version}</span>
          )}
        </>
      }
      footer={footer}
      closeTooltip={
        totalCount > 1
          ? "Schließt alle Meldungen, sie erscheinen danach nicht mehr."
          : "Schließt die Meldung, sie erscheint danach nicht mehr."
      }
    >
      {/* Announcement content */}
      <div>
        <h4 className="text-base font-semibold text-gray-900">
          {current.title}
        </h4>
        <p className="mt-2 text-sm whitespace-pre-wrap text-gray-600">
          {current.content}
        </p>
      </div>
    </Modal>
  );
}
