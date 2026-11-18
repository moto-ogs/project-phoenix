"use client";

import { useMemo } from "react";
import type { OperatorDevice } from "~/lib/operator/provisioning-helpers";
import { getRelativeTime } from "~/lib/format-utils";
import {
  getDeviceTypeDisplayName,
  getDeviceStatusDisplayName,
  formatLastSeen,
  isDeviceBlocked,
  isSystemDevice,
} from "~/lib/iot-helpers";
import { DataTable } from "~/components/ui/data-table";
import type { DataTableColumn } from "~/components/ui/data-table";
import {
  OverflowMenu,
  type OverflowMenuEntry,
} from "~/components/ui/page-header/OverflowMenu";
import { ArrowRightLeft, KeyRound, Lock, LockOpen, Trash2 } from "lucide-react";
import {
  StatusBadge,
  type StatusBadgeTone,
} from "~/components/ui/status-badge";
import { StatusColorBadge } from "~/components/ui/status-color-badge";
import { LOCATION_COLORS } from "~/lib/location-helper";

function DeviceStatusBadge({
  status,
  isOnline,
}: Readonly<{ status: string; isOnline: boolean }>) {
  // A blocked device is refused whatever its last connection says (#2317).
  if (isDeviceBlocked({ status })) {
    return <StatusBadge tone="red" compact label="Gesperrt" />;
  }
  if (isOnline) {
    return <StatusBadge tone="green" compact label="Online" />;
  }
  const label = getDeviceStatusDisplayName(status);
  if (status === "maintenance") {
    return (
      <StatusColorBadge label={label} color={LOCATION_COLORS.WARNING} compact />
    );
  }
  const tones: Record<string, StatusBadgeTone> = {
    active: "green",
    inactive: "gray",
    offline: "red",
  };
  const tone = Object.hasOwn(tones, status) ? tones[status]! : "gray";
  return <StatusBadge tone={tone} compact label={label} />;
}

interface DevicesTableProps {
  devices: OperatorDevice[];
  showSchool?: boolean;
  isLoading?: boolean;
  onSetKey?: (device: OperatorDevice) => void;
  onTransfer?: (device: OperatorDevice) => void;
  /** Blocks (true) or unblocks (false) a device (#2317). */
  onSetBlocked?: (device: OperatorDevice, blocked: boolean) => void;
  onDelete?: (device: OperatorDevice) => void;
}

export function DevicesTable({
  devices,
  showSchool = false,
  isLoading = false,
  onSetKey,
  onTransfer,
  onSetBlocked,
  onDelete,
}: Readonly<DevicesTableProps>) {
  const columns = useMemo<DataTableColumn<OperatorDevice>[]>(() => {
    const cols: DataTableColumn<OperatorDevice>[] = [];

    if (showSchool) {
      cols.push({
        key: "schoolName",
        header: "Schule",
        render: (row) => row.schoolName,
        sortValue: (row) => row.schoolName.toLowerCase(),
        className: "text-gray-600",
      });
    }

    cols.push(
      {
        key: "deviceId",
        header: "Geräte-ID",
        render: (row) => row.deviceId,
        sortValue: (row) => row.deviceId.toLowerCase(),
        className: "font-mono text-xs font-medium text-gray-900",
      },
      {
        key: "name",
        header: "Name",
        render: (row) => row.name || "–",
        sortValue: (row) => (row.name || "").toLowerCase(),
        className: "text-gray-600",
      },
      {
        key: "deviceType",
        header: "Typ",
        render: (row) => (
          <StatusBadge
            tone="gray"
            compact
            label={getDeviceTypeDisplayName(row.deviceType)}
          />
        ),
        sortValue: (row) => row.deviceType.toLowerCase(),
      },
      {
        key: "status",
        header: "Status",
        render: (row) => (
          <DeviceStatusBadge status={row.status} isOnline={row.isOnline} />
        ),
        sortValue: (row) => row.status.toLowerCase(),
      },
      {
        key: "lastSeen",
        header: "Zuletzt online",
        render: (row) =>
          row.lastSeen ? (
            <span title={formatLastSeen(row.lastSeen)}>
              {getRelativeTime(row.lastSeen)}
            </span>
          ) : (
            <span className="text-gray-500">Nie</span>
          ),
        sortValue: (row) => row.lastSeen ?? "",
        className: "text-gray-600",
      },
      {
        key: "apiKey",
        header: "API-Key",
        render: (row) =>
          row.maskedApiKey ? (
            <span className="font-mono text-xs text-gray-500">
              {row.maskedApiKey}
            </span>
          ) : (
            <span className="text-gray-500">–</span>
          ),
        sortValue: (row) => row.maskedApiKey.toLowerCase(),
      },
    );

    if (onSetKey || onTransfer || onSetBlocked || onDelete) {
      cols.push({
        key: "actions",
        header: "Aktionen",
        render: (row) => {
          const items: OverflowMenuEntry[] = [];
          if (onTransfer) {
            items.push({
              label: "Schule wechseln",
              icon: <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />,
              onClick: () => onTransfer(row),
            });
          }
          if (onSetKey) {
            items.push({
              label: "API-Key ändern",
              icon: <KeyRound className="h-4 w-4" aria-hidden="true" />,
              onClick: () => onSetKey(row),
            });
          }
          if (onSetBlocked && !isSystemDevice(row)) {
            const blocked = isDeviceBlocked(row);
            items.push({
              label: blocked ? "Entsperren" : "Sperren",
              description: blocked
                ? "Gibt dem Gerät sofort wieder Zugang."
                : "Weist den Kiosk sofort ab. Gerät, Raum und Verlauf bleiben.",
              icon: blocked ? (
                <LockOpen className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Lock className="h-4 w-4" aria-hidden="true" />
              ),
              onClick: () => onSetBlocked(row, !blocked),
            });
          }
          if (onDelete) {
            if (items.length > 0) items.push({ kind: "separator" });
            items.push({
              label: "Entfernen",
              icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
              destructive: true,
              onClick: () => onDelete(row),
            });
          }
          return (
            <OverflowMenu
              items={items}
              triggerSize="sm"
              ariaLabel={`Aktionen für ${row.name || row.deviceId}`}
            />
          );
        },
      });
    }

    return cols;
  }, [showSchool, onSetKey, onTransfer, onSetBlocked, onDelete]);

  return (
    <DataTable
      columns={columns}
      rows={devices}
      getRowKey={(row) => row.id}
      defaultSortKey={showSchool ? "schoolName" : "deviceId"}
      isLoading={isLoading}
    />
  );
}
