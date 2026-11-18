import { Info } from "lucide-react";
import { ProgressBar } from "~/components/ui/progress-bar";
import { Tooltip } from "~/components/ui/tooltip";
import { formatCount } from "~/lib/format-utils";
import {
  deviceSlotsFull,
  freeDeviceSlots,
  type DeviceSlots,
} from "~/lib/device-slots";

function places(count: number): string {
  return `${formatCount(count)} ${count === 1 ? "Geräteplatz" : "Geräteplätze"}`;
}

function explanation(booked: number, full: boolean): string {
  const text = `Deine Schule hat ${places(booked)}. Jedes registrierte Gerät belegt einen Platz, auch ein gesperrtes. Entfernst du ein Gerät, wird sein Platz frei.`;
  return full ? `${text} Für weitere Plätze melde dich beim moto-Team.` : text;
}

/**
 * Geräteplätze der Schule in der Statuszeile der Geräteliste (#2312), nach
 * dem Muster des Kinderkontingents: eine eigene Zeile mit Namen, damit die
 * Zahl nicht mit der Zahl der Geräte in der Liste verwechselt wird. Der
 * schmale Balken zeigt die Belegung auf einen Blick, die Erklärung steht im
 * Tooltip. Ohne Grenze zeigt die Zeile nichts. Sie steht im Absatz der
 * Statuszeile, deshalb nur Spans.
 */
export function DeviceSlotStatus({
  slots,
}: Readonly<{ slots: DeviceSlots | null | undefined }>) {
  if (!slots || slots.booked === null) return null;
  const { booked, occupied } = slots;
  const full = deviceSlotsFull(slots);
  const free = freeDeviceSlots(booked, occupied) ?? 0;
  return (
    // Die Blase hängt an der ganzen Zeile, nicht am Symbol: auf dem Telefon
    // bricht die Zeile um und eine Blase am Symbol liefe aus dem Bildschirm.
    <span
      className="relative mt-1 flex flex-wrap items-center gap-x-2 gap-y-1"
      data-testid="device-slot-status"
    >
      <span>
        Geräteplätze:{" "}
        <span className="font-medium text-gray-900 tabular-nums">
          {`${formatCount(occupied)} von ${formatCount(booked)}`}
        </span>{" "}
        belegt
      </span>
      <span className="inline-flex w-16" aria-hidden>
        <ProgressBar
          label={`${formatCount(occupied)} von ${formatCount(booked)} Geräteplätzen belegt`}
          value={occupied}
          max={booked}
          size="sm"
          tone={full ? "orange" : "green"}
        />
      </span>
      <span
        className={full ? "text-moto-orange-strong font-medium" : undefined}
      >
        {full ? "voll" : `${formatCount(free)} frei`}
      </span>
      <Tooltip
        content={explanation(booked, full)}
        className="static inline-flex"
        bubbleClassName="right-0 w-auto max-w-sm"
      >
        <Info aria-label="Was zählt?" className="h-4 w-4 text-gray-500" />
      </Tooltip>
    </span>
  );
}
