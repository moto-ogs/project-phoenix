"use client";

import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";

/**
 * Keeps the target clear of the sticky page header when it scrolls to the
 * top (`globals.css`). Set by `jumpTo`, so no page needs its own `scroll-mt`.
 */
const JUMP_TARGET_CLASS = "moto-jump-target";

const FOCUSABLE =
  "input, select, textarea, button, a[href], [tabindex]:not([tabindex='-1'])";

/**
 * Brings a place of the page into view and moves the focus there, so a
 * keyboard or screen reader user lands there too (#7054): a field gets the
 * focus itself, a card or section the focus on its heading, anything else
 * the focus on the element. Returns `false` when the place is not on the
 * page (an editor replaced it, a section is hidden); then nothing happens.
 */
export function jumpTo(id: string): boolean {
  const target = globalThis.document?.getElementById(id);
  if (!target || isHidden(target)) return false;
  target.classList.add(JUMP_TARGET_CLASS);
  // happy-dom and older WebKit builds ship no scrollIntoView on every node.
  target.scrollIntoView?.({ block: "start" });
  const focusTarget = focusTargetOf(target);
  if (!focusTarget.matches(FOCUSABLE)) focusTarget.tabIndex = -1;
  focusTarget.focus({ preventScroll: true });
  return true;
}

/** A collapsed, `hidden` or `display: none` place cannot take the focus. */
function isHidden(target: HTMLElement): boolean {
  if (target.closest("[hidden], [inert]")) return true;
  return target.checkVisibility?.() === false;
}

/**
 * A field takes the focus itself. A disabled one cannot: the heading of the
 * nearest card or section around it does. Anything else focuses its own
 * heading, else itself.
 */
function focusTargetOf(target: HTMLElement): HTMLElement {
  const heading = (node: Element | null) =>
    node?.querySelector<HTMLElement>("h1, h2, h3, h4") ?? null;
  if (!target.matches(FOCUSABLE)) return heading(target) ?? target;
  if (!target.matches(":disabled")) return target;
  return (
    heading(target.closest("section, [id]:not(input, select, textarea)")) ??
    target
  );
}

/**
 * The button in a notice that leads to the place on the same page where the
 * person fixes it (#7054), such as „Zu den Eltern“ in a holiday registration.
 * Goes into `Alert action` / `FormErrorAlert action` or a row of
 * `ResponsiveActionList`. The rule for every notice that names another place:
 *
 * - Same page: this button; the target carries the `id` (an exported constant,
 *   `useId` when the component repeats). Tooltip „Springt zu …“.
 * - Another page or a setting: `ButtonLink variant="surface" size="compact"`
 *   through `useTenantAwarePath`; school settings `?tab=…&highlight=<key>`,
 *   Träger settings `?bereich=…`. Tooltip „Öffnet …“.
 * - From a dialog or slide-over the link opens a new tab, so the input stays.
 * - Only with the viewer's right for the target; otherwise the text names who
 *   acts. No link at the notice's own field, beside the page head's same
 *   action, or when only moto support can fix it. Error codes: #7092.
 */
export function JumpButton({
  targetId,
  tooltip,
  children,
  "aria-label": ariaLabel,
}: Readonly<{
  /** `id` of the card, section or field to bring into view. */
  targetId: string;
  /** What the click does, as „Springt zu …“ (frontend-ui-kit.md). */
  tooltip: string;
  /** Names the place: „Zu den Eltern“, „Zum Feld E-Mail“. */
  children: ReactNode;
  "aria-label"?: string;
}>) {
  return (
    <Button
      type="button"
      variant="surface"
      size="compact"
      aria-label={ariaLabel}
      tooltip={tooltip}
      onClick={() => jumpTo(targetId)}
    >
      {children}
    </Button>
  );
}
