"use client";

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

interface UnreadAnnouncement {
  id: number | string;
  title: string;
  content: string;
  type: string;
  severity: string;
  version?: string;
  published_at: string;
}

export function AnnouncementModal() {
  const { announcements, dismiss, markSeen, isLoading, refresh } =
    useAnnouncements();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  // Keep a stable snapshot of announcements when modal opens
  const [queuedAnnouncements, setQueuedAnnouncements] = useState<
    UnreadAnnouncement[]
  >([]);
  const dismissedIdsRef = useRef<Set<string>>(new Set());
  // Track IDs the user has seen (closed without dismissing) to avoid re-opening
  const closedIdsRef = useRef<Set<string>>(new Set());
  // Einstieg (#7555): IDs already reported as seen, and whether this opening
  // of the modal was reported as shown. Refs survive re-renders, so neither
  // is sent twice.
  const seenIdsRef = useRef<Set<string>>(new Set());
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
    const key = String(currentId);
    if (seenIdsRef.current.has(key)) return;
    seenIdsRef.current.add(key);
    // Fire-and-forget like dismiss: a failed report must not block reading.
    markSeen(currentId).catch((error: unknown) => {
      logger.error("announcement_seen_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, [isVisible, currentId, markSeen]);

  // Dismiss current and advance to next announcement ("Weiter" / "Verstanden")
  const handleDismiss = useCallback(async () => {
    const current = queuedAnnouncements[currentIndex];
    if (!current) return;

    // Track this ID as dismissed locally
    dismissedIdsRef.current.add(String(current.id));

    // Send dismiss to backend (fire-and-forget, don't block UI)
    dismiss(current.id).catch((error) => {
      logger.error("announcement_dismiss_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });

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
  }, [queuedAnnouncements, currentIndex, dismiss, refresh]);

  // Close modal entirely (X button, backdrop, Escape key)
  // Dismiss all queued announcements on the backend so they don't reappear on next login
  const handleClose = useCallback(() => {
    trackOnboardingSurface("dismissed", "announcement");
    for (const a of queuedAnnouncements) {
      closedIdsRef.current.add(String(a.id));
      if (!dismissedIdsRef.current.has(String(a.id))) {
        dismissedIdsRef.current.add(String(a.id));
        dismiss(a.id).catch((error) => {
          logger.error("announcement_dismiss_failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }
    setIsVisible(false);
  }, [queuedAnnouncements, dismiss]);

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
