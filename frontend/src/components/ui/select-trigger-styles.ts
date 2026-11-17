import { cn } from "~/lib/utils";

import { CONTROL_HEIGHT_CLASS, type ControlSize } from "./control-geometry";

const TRIGGER_BASE_CLASS =
  "flex items-center justify-between gap-2 px-3 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-gray-900 disabled:cursor-not-allowed disabled:bg-gray-100! disabled:text-gray-500 disabled:opacity-80";
const TRIGGER_FRAME_CLASS = "rounded-lg border";
// Heights from the kit's one size vocabulary (control-geometry.ts). By
// finger the compact select reaches 44 px and 16-px text, like the kit's
// fields and buttons; the dense one stays for dense toolbars.
const TRIGGER_HEIGHT_CLASS = {
  compact: `${CONTROL_HEIGHT_CLASS.touch} pointer-coarse:text-base`,
  dense: CONTROL_HEIGHT_CLASS.dense,
} as const satisfies Partial<Record<ControlSize, string>>;
// `moto-content-surface` is unlayered: it beats the red invalid tint and the
// grey disabled fill, so it sits on the neutral, enabled branch only.
const TRIGGER_SURFACE_CLASS =
  "moto-content-surface moto-hover-elevated border-gray-500/80!";
const TRIGGER_DISABLED_CLASS = "border-gray-200";
const TRIGGER_INVALID_CLASS = "border-moto-red! bg-moto-red/5!";
// Between the arrows of a framed group (#7300): frame, radius and surface come
// from the group. The trigger fills the group's height and tints on hover like
// its segments (`Button variant="segment"`). The focus outline sits inside the
// trigger, where the group's `overflow-hidden` cannot clip it.
const TRIGGER_EMBEDDED_CLASS =
  "h-full rounded-none focus-visible:-outline-offset-2";
const TRIGGER_EMBEDDED_ENABLED_CLASS = "hover:bg-gray-100 active:bg-gray-200";
const TRIGGER_EMBEDDED_INVALID_CLASS =
  "bg-moto-red/5 ring-1 ring-moto-red ring-inset";

export type SelectTriggerSize = keyof typeof TRIGGER_HEIGHT_CLASS;

/**
 * The trigger look of every select in the kit (#5580), shared with the trigger
 * of `DateRangePicker` (#5585). It lives apart from `ListboxDropdown` so a
 * picker can use the look without loading the listbox.
 */
export function selectTriggerClassName({
  size = "compact",
  invalid = false,
  disabled = false,
  embedded = false,
  className,
}: Readonly<{
  size?: SelectTriggerSize;
  invalid?: boolean;
  disabled?: boolean;
  /**
   * Between the arrows of a framed group (`PlanningContextBar
   * navigationInGroup`): no frame, radius or surface of its own, the height
   * comes from the group. Mark the trigger with `CONTROL_PART`.
   */
  embedded?: boolean;
  /** Layout only (width, flex). */
  className?: string;
}> = {}): string {
  if (embedded) {
    return cn(
      TRIGGER_BASE_CLASS,
      TRIGGER_EMBEDDED_CLASS,
      invalid
        ? TRIGGER_EMBEDDED_INVALID_CLASS
        : !disabled && TRIGGER_EMBEDDED_ENABLED_CLASS,
      className,
    );
  }
  return cn(
    TRIGGER_BASE_CLASS,
    TRIGGER_FRAME_CLASS,
    TRIGGER_HEIGHT_CLASS[size],
    invalid
      ? TRIGGER_INVALID_CLASS
      : disabled
        ? TRIGGER_DISABLED_CLASS
        : TRIGGER_SURFACE_CLASS,
    className,
  );
}
