import type { ReactNode } from "react";
import { History, KeyRound, RotateCcw } from "lucide-react";

import { ApiError } from "~/lib/api-error";
import { InsetPanel } from "~/components/ui/inset-panel";
import { MotoDuotoneIcon } from "~/components/ui/moto-duotone-icon";
import { SectionLabel } from "~/components/ui/section-label";
import { devicesConcept } from "~/lib/concepts/devices";

// Geräteentfernung (#2319): what removing a device does, shown in the
// school portal and the operator portal alike, so both explain the same
// outcome. The backend archives the device: access ends at once, its place
// is free for a new device, and the history keeps naming it.

const CONSEQUENCES = [
  {
    icon: KeyRound,
    text: "Das Gerät verliert sofort den Zugang zu moto.",
  },
  {
    icon: RotateCcw,
    text: "Sein Platz wird frei. Du kannst ein neues Gerät registrieren.",
  },
  {
    icon: History,
    text: "Bisherige Anwesenheiten und Sitzungen bleiben erhalten.",
  },
] as const;

interface DeviceRemovalSummaryProps {
  /** Name the school gave the device, or its device ID. */
  readonly title: string;
  readonly deviceId: string;
  /** Where the device belongs, e.g. the school in the operator portal. */
  readonly context?: string | null;
  /** Hint under the consequences, e.g. the open-session precondition. */
  readonly footnote?: ReactNode;
}

export function DeviceRemovalSummary({
  title,
  deviceId,
  context,
  footnote,
}: DeviceRemovalSummaryProps) {
  return (
    <div className="space-y-4">
      <InsetPanel padding="sm" className="flex items-center gap-3">
        <MotoDuotoneIcon
          icon={devicesConcept.icon}
          tone={devicesConcept.tone}
          size={36}
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900">
            {title}
          </p>
          <p className="truncate text-xs text-gray-500">
            <span className="font-mono">{deviceId}</span>
            {context ? ` · ${context}` : null}
          </p>
        </div>
      </InsetPanel>

      <div>
        <SectionLabel as="h3">Das passiert beim Entfernen</SectionLabel>
        <ul className="mt-2 space-y-2">
          {CONSEQUENCES.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-2.5">
              <Icon
                className="mt-0.5 h-4 w-4 shrink-0 text-gray-500"
                aria-hidden
              />
              <span className="text-gray-700">{text}</span>
            </li>
          ))}
        </ul>
      </div>

      {footnote ? <p className="text-xs text-gray-500">{footnote}</p> : null}
    </div>
  );
}

/**
 * A removal that finds no live device: someone removed it a moment ago.
 * Removal is idempotent, so the screen treats this as done, not as an error.
 */
export function isDeviceAlreadyRemoved(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}
