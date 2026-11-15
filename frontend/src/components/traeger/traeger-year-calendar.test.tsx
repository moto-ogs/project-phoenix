import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { CalendarDayMark } from "./closing-day-format";
import { TraegerYearCalendar } from "./traeger-year-calendar";

const marks = new Map<string, CalendarDayMark>([
  ["2027-01-01", { kind: "holiday", labels: ["Neujahr"] }],
  ["2027-01-04", { kind: "closing", labels: ["Schließtag: Brückentag"] }],
]);

describe("TraegerYearCalendar (#7114)", () => {
  it("unterscheidet Feiertag und Schließtag auch in der Form, nicht nur in der Farbe", () => {
    render(
      <TraegerYearCalendar year={2027} marks={marks} todayISO="2027-03-01" />,
    );

    const holiday = screen.getByRole("img", {
      name: "Freitag, 1. Januar: Neujahr",
    });
    const closing = screen.getByRole("img", {
      name: "Montag, 4. Januar: Schließtag: Brückentag",
    });
    expect(holiday).toHaveClass("rounded-full");
    expect(holiday).not.toHaveClass("border");
    expect(closing).toHaveClass("rounded-sm", "border");
    expect(closing).not.toHaveClass("rounded-full");
  });
});
