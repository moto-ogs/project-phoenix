import { Button } from "~/components/ui/button";
import { ProgressBar } from "~/components/ui/progress-bar";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { formatCount } from "~/lib/format-utils";
import { deviceSlotsFull, freeDeviceSlots } from "~/lib/device-slots";

/**
 * Geräteplätze einer Schule im Geräte-Reiter des Operator-Portals (#2312):
 * gekauft, belegt und frei auf einen Blick, mit dem Weg zum Ändern. Ist
 * alles belegt, lehnt Phoenix jedes weitere Gerät ab, auch eine
 * Übertragung an diese Schule.
 */
export function DeviceSlotsCard({
  deviceSlots,
  occupied,
  onEdit,
}: Readonly<{
  deviceSlots: number | null;
  occupied: number;
  onEdit: () => void;
}>) {
  const full = deviceSlotsFull({ booked: deviceSlots, occupied });
  const free = freeDeviceSlots(deviceSlots, occupied);
  return (
    <SectionCard
      title="Geräteplätze"
      titleBadge={
        deviceSlots === null ? (
          <StatusBadge size="xs" tone="gray" label="Keine Grenze" />
        ) : full ? (
          <StatusBadge size="xs" tone="orange" label="Voll" />
        ) : null
      }
      description={
        deviceSlots === null
          ? "Die Schule kann beliebig viele Geräte registrieren, bis eine Grenze gesetzt ist."
          : "Jedes registrierte Gerät belegt einen Platz, auch ein gesperrtes."
      }
      action={
        <Button type="button" variant="outline" size="compact" onClick={onEdit}>
          {deviceSlots === null ? "Grenze festlegen" : "Ändern"}
        </Button>
      }
      testId="device-slots-card"
      className="mb-4"
    >
      {deviceSlots === null ? (
        <p className="text-sm text-gray-700">
          <span className="font-semibold text-gray-900 tabular-nums">
            {formatCount(occupied)}
          </span>{" "}
          {occupied === 1 ? "Gerät registriert" : "Geräte registriert"}
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="text-sm text-gray-700">
              <span className="text-2xl font-semibold text-gray-900 tabular-nums">
                {formatCount(occupied)}
              </span>
              <span className="text-gray-500 tabular-nums">
                {" "}
                / {formatCount(deviceSlots)}
              </span>{" "}
              belegt
            </p>
            <p
              className={`text-sm tabular-nums ${full ? "text-moto-orange-strong font-medium" : "text-gray-600"}`}
            >
              {full
                ? "Keine freien Plätze"
                : `${formatCount(free ?? 0)} ${free === 1 ? "Platz" : "Plätze"} frei`}
            </p>
          </div>
          <ProgressBar
            label={`${formatCount(occupied)} von ${formatCount(deviceSlots)} Geräteplätzen belegt`}
            value={occupied}
            max={Math.max(deviceSlots, 1)}
            tone={full ? "orange" : "green"}
          />
        </div>
      )}
    </SectionCard>
  );
}
