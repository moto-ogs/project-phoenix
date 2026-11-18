// Verbindung eines Geräts auf einen Blick (#2321): online, offline oder
// noch nie verbunden, mit dem letzten Kontakt. Online heißt: Das Gerät hat
// sich im Zeitfenster der Schule gemeldet. Ob es gesperrt ist, sagt der
// Status daneben; die Verbindung überschreibt ihn nie.

import { Lock, Unplug, Wifi, WifiOff } from "lucide-react";
import { IconTile } from "~/components/ui/icon-tile";
import { InsetPanel } from "~/components/ui/inset-panel";
import { formatBerlinDate, formatTime } from "~/lib/date-helpers";
import { formatRelativeLastSeen } from "~/lib/iot-helpers";

interface DeviceConnectionSummaryProps {
  readonly isOnline: boolean;
  readonly lastSeen?: string;
  /** A blocked device is refused, whatever its last contact says (#2317). */
  readonly blocked?: boolean;
}

/** „Letzter Kontakt vor 3 Std. · 18.11.2026, 14:05 Uhr“ */
function lastContact(lastSeen: string): string {
  const relative = formatRelativeLastSeen(lastSeen);
  const when = relative === "Gerade eben" ? "gerade eben" : relative;
  return `Letzter Kontakt ${when} · ${formatBerlinDate(lastSeen)}, ${formatTime(lastSeen)} Uhr`;
}

export function DeviceConnectionSummary({
  isOnline,
  lastSeen,
  blocked = false,
}: DeviceConnectionSummaryProps) {
  const state = blocked
    ? {
        icon: <Lock aria-hidden="true" />,
        tone: "neutral" as const,
        title: "Keine Verbindung möglich",
        detail: lastSeen
          ? lastContact(lastSeen)
          : "Das Gerät hat sich noch nie bei moto gemeldet.",
      }
    : isOnline
      ? {
          icon: <Wifi aria-hidden="true" />,
          tone: "green" as const,
          title: "Online",
          detail: lastSeen
            ? lastContact(lastSeen)
            : "Das Gerät meldet sich gerade.",
        }
      : lastSeen
        ? {
            icon: <WifiOff aria-hidden="true" />,
            tone: "orange" as const,
            title: "Offline",
            detail: lastContact(lastSeen),
          }
        : {
            icon: <Unplug aria-hidden="true" />,
            tone: "neutral" as const,
            title: "Noch nie verbunden",
            detail: "Das Gerät hat sich noch nie bei moto gemeldet.",
          };
  return (
    <InsetPanel padding="md" className="flex items-center gap-3">
      <IconTile icon={state.icon} size="sm" shape="round" tone={state.tone} />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900">{state.title}</p>
        <p className="text-sm text-gray-600">{state.detail}</p>
      </div>
    </InsetPanel>
  );
}
