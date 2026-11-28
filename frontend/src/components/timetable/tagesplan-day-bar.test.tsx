import { render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TagesplanDayBar } from "./tagesplan-app";

function dayChips(): string[] {
  const bar = document.querySelector<HTMLElement>("[data-tagesplan-day-bar]");
  if (!bar) throw new Error("Tagesleiste fehlt");
  return within(bar)
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label") ?? button.textContent)
    .filter(
      (name): name is string =>
        name !== null && !/^(Vorheriger|Nächster) Tag$|^Heute$/.test(name),
    );
}

function renderBar(day: string, today = day) {
  render(
    <TagesplanDayBar
      day={day}
      today={today}
      onSelect={vi.fn()}
      onPrevious={vi.fn()}
      onNext={vi.fn()}
    />,
  );
}

describe("TagesplanDayBar", () => {
  it("shows Monday to Friday on a weekday", () => {
    renderBar("2026-11-25");
    expect(dayChips()).toHaveLength(5);
    expect(dayChips()[0]).toMatch(/^Mo/);
    expect(dayChips()[4]).toMatch(/^Fr/);
  });

  it.each([
    ["Saturday", "2026-11-28", /^Sa/],
    ["Sunday", "2026-11-29", /^So/],
  ])(
    "keeps five chips on a %s and ends with that day, so each chip keeps its 44 px target",
    (_, day, last) => {
      renderBar(day);
      const chips = dayChips();
      expect(chips).toHaveLength(5);
      expect(chips[0]).toMatch(/^Di/);
      expect(chips[3]).toMatch(/^Fr/);
      expect(chips[4]).toMatch(last);
    },
  );
});
