import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { AuthShell } from "./auth-shell";

function renderShell() {
  render(
    <AuthShell variant="tenant" title="Anmelden">
      <p>Formular</p>
    </AuthShell>,
  );
}

function testimonialButton(number: number) {
  return screen.getByRole("button", {
    name: `Erfahrungsbericht ${number} anzeigen`,
  });
}

describe("AuthShell Erfahrungsberichte (#7114)", () => {
  it("wechselt den Bericht nicht von selbst (WCAG 2.2.2)", () => {
    vi.useFakeTimers();
    renderShell();
    expect(testimonialButton(1)).toHaveAttribute("aria-pressed", "true");

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(testimonialButton(1)).toHaveAttribute("aria-pressed", "true");
    expect(testimonialButton(2)).toHaveAttribute("aria-pressed", "false");
  });

  it("wechselt auf Klick zum gewählten Bericht", () => {
    renderShell();

    fireEvent.click(testimonialButton(3));

    expect(testimonialButton(3)).toHaveAttribute("aria-pressed", "true");
    expect(testimonialButton(1)).toHaveAttribute("aria-pressed", "false");
  });

  it("gibt jedem Punkt eine Trefferfläche von mindestens 24 × 24 px (WCAG 2.5.8)", () => {
    renderShell();

    // jsdom misst kein Layout: 10 px Strich plus 2 × 7 px Rand ergeben
    // 24 px, die Farbe füllt nur die Inhaltsfläche.
    expect(testimonialButton(2)).toHaveClass(
      "box-content",
      "h-2.5",
      "w-2.5",
      "p-[7px]",
      "bg-clip-content",
    );
  });
});
