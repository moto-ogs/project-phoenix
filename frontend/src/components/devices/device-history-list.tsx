"use client";

// Der Verlauf eines Geräts (#2321) als Zeitleiste: Tage als Gruppen, je
// Eintrag ein Symbol, was geschah, wer es tat, wann, und die geänderten
// Werte. Nur zum Lesen; Schulportal und Operator-Portal zeigen dieselbe
// Liste.

import {
  ArrowRightLeft,
  History,
  KeyRound,
  Lock,
  LockOpen,
  PencilLine,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "~/components/ui/empty-state";
import { FramedList } from "~/components/ui/framed-list";
import { IconTile } from "~/components/ui/icon-tile";
import { ListGroupHeader } from "~/components/ui/list-group-header";
import { Skeleton } from "~/components/ui/skeleton";
import {
  describeDeviceHistoryEntry,
  deviceHistoryActor,
  deviceHistoryTime,
  groupDeviceHistoryByDay,
  type DeviceHistoryEntry,
} from "~/lib/device-history";

const ICONS: Readonly<Record<string, ReactNode>> = {
  created: <Plus aria-hidden="true" />,
  updated: <PencilLine aria-hidden="true" />,
  blocked: <Lock aria-hidden="true" />,
  unblocked: <LockOpen aria-hidden="true" />,
  status_changed: <RefreshCw aria-hidden="true" />,
  key_rotated: <KeyRound aria-hidden="true" />,
  removed: <Trash2 aria-hidden="true" />,
  transferred_out: <ArrowRightLeft aria-hidden="true" />,
  transferred_in: <ArrowRightLeft aria-hidden="true" />,
};

interface DeviceHistoryListProps {
  readonly entries: readonly DeviceHistoryEntry[];
  /** Who reads: the school sees its staff by name, the operator the school. */
  readonly portal: "school" | "operator";
  readonly loading?: boolean;
}

/** One change: symbol, what happened, by whom and when, the changed values. */
function DeviceHistoryRow({
  entry,
  portal,
  showSchool,
}: Readonly<{
  entry: DeviceHistoryEntry;
  portal: "school" | "operator";
  showSchool: boolean;
}>) {
  const { title, tone, details } = describeDeviceHistoryEntry(entry);
  const meta = [
    deviceHistoryActor(entry, portal),
    showSchool && entry.schoolName ? entry.schoolName : null,
    deviceHistoryTime(entry),
  ].filter((part): part is string => Boolean(part));
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <IconTile
        icon={ICONS[entry.action] ?? <History aria-hidden="true" />}
        size="xs"
        shape="round"
        tone={tone}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="text-xs text-gray-500">{meta.join(" · ")}</p>
        {details.length > 0 ? (
          <ul className="mt-1.5 space-y-0.5 text-sm text-gray-700">
            {details.map((line) => (
              <li key={line} className="wrap-anywhere">
                {line}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

function DeviceHistorySkeleton() {
  return (
    <FramedList>
      {[0, 1, 2].map((index) => (
        <li
          key={index}
          className="flex items-start gap-3 px-4 py-3"
          aria-hidden="true"
        >
          <Skeleton shape="round" className="h-8 w-8" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </li>
      ))}
    </FramedList>
  );
}

/**
 * The history of one device, newest first and grouped by day. Without
 * entries it says what will appear here.
 */
export function DeviceHistoryList({
  entries,
  portal,
  loading = false,
}: DeviceHistoryListProps) {
  if (loading) {
    return (
      <div role="status" aria-label="Verlauf wird geladen">
        <DeviceHistorySkeleton />
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <EmptyState
        variant="dashed"
        icon={<History className="h-10 w-10" aria-hidden="true" />}
        titleAs="h3"
        title="Noch keine Änderungen"
        description="Hier steht, wer das Gerät angelegt, geändert, gesperrt oder entsperrt hat."
      />
    );
  }
  // A device that stayed at one school needs no school in every row.
  const showSchool =
    portal === "operator" &&
    new Set(entries.map((entry) => entry.schoolName)).size > 1;
  return (
    <div className="space-y-4">
      {groupDeviceHistoryByDay(entries).map((day) => (
        <section key={day.day} aria-label={day.label} className="space-y-2">
          <ListGroupHeader
            title={day.label}
            as="h3"
            meta={
              <span className="text-xs text-gray-500">
                {day.entries.length === 1
                  ? "1 Änderung"
                  : `${day.entries.length} Änderungen`}
              </span>
            }
          />
          <FramedList>
            {day.entries.map((entry) => (
              <DeviceHistoryRow
                key={entry.id}
                entry={entry}
                portal={portal}
                showSchool={showSchool}
              />
            ))}
          </FramedList>
        </section>
      ))}
    </div>
  );
}
