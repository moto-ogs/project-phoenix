import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useStepFocus } from "./use-step-focus";

function Steps({
  step,
}: Readonly<{ step: "form" | "summary" | "done" | null }>) {
  const ref = useStepFocus<HTMLDivElement>(step);
  if (step === "done") {
    return (
      <div ref={ref}>
        <h2>Fertig</h2>
      </div>
    );
  }
  if (step === "summary") {
    return (
      <div ref={ref}>
        <p>Vorspann</p>
        <h3>Zusammenfassung</h3>
        <button type="button">Absenden</button>
      </div>
    );
  }
  if (step === null) return <p>Lädt …</p>;
  return (
    <div ref={ref}>
      <h2>Formular</h2>
      <input aria-label="Name" />
    </div>
  );
}

describe("useStepFocus", () => {
  it("leaves the focus alone on the first render", () => {
    render(<Steps step="form" />);

    expect(screen.getByRole("heading", { name: "Formular" })).toBeVisible();
    expect(document.activeElement).toBe(document.body);
  });

  it("focuses the heading of each new step", () => {
    const { rerender } = render(<Steps step="form" />);

    rerender(<Steps step="summary" />);
    const summary = screen.getByRole("heading", { name: "Zusammenfassung" });
    expect(summary).toHaveFocus();
    expect(summary).toHaveAttribute("tabindex", "-1");

    rerender(<Steps step="done" />);
    expect(screen.getByRole("heading", { name: "Fertig" })).toHaveFocus();
  });

  it("does not move the focus while the step stays the same", () => {
    const { rerender } = render(<Steps step="form" />);
    rerender(<Steps step="summary" />);
    const send = screen.getByRole("button", { name: "Absenden" });
    send.focus();

    rerender(<Steps step="summary" />);

    expect(send).toHaveFocus();
  });

  it("keeps the focus when the first step appears after loading", () => {
    const { rerender } = render(<Steps step={null} />);

    rerender(<Steps step="form" />);

    expect(screen.getByRole("heading", { name: "Formular" })).toBeVisible();
    expect(document.activeElement).toBe(document.body);
  });
});
