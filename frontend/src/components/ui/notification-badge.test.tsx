import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NotificationBadge } from "./notification-badge";

/**
 * The badge has no own name (#7112): its count is visible text, the rest of
 * the sentence follows as hidden text, so the control around it reads both.
 */
function badge(container: HTMLElement): HTMLElement {
  const element = container.firstElementChild;
  if (!(element instanceof HTMLElement)) throw new Error("no badge rendered");
  return element;
}

describe("NotificationBadge", () => {
  it("uses the orange tone and provided accessible label", () => {
    const { container } = render(
      <NotificationBadge
        count={2}
        tone="orange"
        ariaLabel="2 offene Abwesenheitsanträge"
      />,
    );

    // -strong, not the raw brand orange: white on #F78C10 is 2.41:1, under
    // even the 3:1 non-text floor.
    expect(badge(container)).toHaveClass("bg-moto-orange-strong", "text-white");
    expect(badge(container)).toHaveTextContent(
      /^2 offene Abwesenheitsanträge$/,
    );
    expect(badge(container)).not.toHaveAttribute("aria-label");
  });

  it("uses the blue tone and caps the visible count", () => {
    const { container } = render(
      <NotificationBadge
        count={120}
        tone="blue"
        ariaLabel="120 ungelesene Nachrichten"
      />,
    );

    expect(badge(container)).toHaveClass("bg-moto-blue-strong", "text-white");
    // The capped number is only shown; the full count is read.
    expect(screen.getByText("99+")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("120 ungelesene Nachrichten")).toHaveClass(
      "sr-only",
    );
  });

  it("caps at a lower maximum when the caller sets one", () => {
    const { rerender } = render(
      <NotificationBadge count={9} tone="red" max={9} ariaLabel="9 neu" />,
    );
    expect(screen.getByText("9")).toBeInTheDocument();

    rerender(
      <NotificationBadge count={10} tone="red" max={9} ariaLabel="10 neu" />,
    );
    expect(screen.getByText("9+")).toBeInTheDocument();
  });

  it("uses the coral tone", () => {
    const { container } = render(
      <NotificationBadge
        count={3}
        tone="coral"
        ariaLabel="3 neue Feedbackeinträge"
      />,
    );

    expect(badge(container)).toHaveClass("bg-moto-coral-strong", "text-white");
    expect(badge(container)).toHaveTextContent(/^3 neue Feedbackeinträge$/);
  });

  it("renders nothing for an empty count", () => {
    const { container } = render(
      <NotificationBadge count={0} tone="orange" ariaLabel="Keine" />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ["red", "bg-moto-red"],
    ["blue", "bg-moto-blue-strong"],
  ] as const)("shows the %s tone with white text", (tone, fill) => {
    const { container } = render(
      <NotificationBadge count={3} tone={tone} ariaLabel="3 offen" />,
    );

    expect(badge(container)).toHaveClass(fill, "text-white");
    expect(badge(container)).toHaveTextContent(/^3 offen$/);
  });
});
