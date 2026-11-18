import { formatDate, formatTime } from "~/lib/date-helpers";
import type { DeviceTransferStatus } from "~/lib/operator/provisioning-helpers";

type DeviceSession = NonNullable<DeviceTransferStatus["activeSession"]>;

/** A device instant on the Berlin clock, e.g. „18.11.2026, 13:26“. */
export function formatDeviceTimestamp(value: string): string {
  return `${formatDate(value)}, ${formatTime(value)}`;
}

/**
 * The open session that blocks moving or removing a device, followed by
 * what the operator has to do first.
 */
export function formatDeviceSessionMessage(
  session: DeviceSession,
  nextStep: string,
): string {
  const activity = session.activityName ? ` · ${session.activityName}` : "";
  const room = session.roomName ? ` · ${session.roomName}` : "";
  return `Offene Sitzung seit ${formatDeviceTimestamp(session.startedAt)}${activity}${room}. ${nextStep}`;
}
