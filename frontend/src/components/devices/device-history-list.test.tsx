import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeviceHistoryList } from "./device-history-list";
import type { DeviceHistoryEntry } from "~/lib/device-history";
import { testClockDay } from "~/test/clock-instant";

const today = testClockDay();

const entries: DeviceHistoryEntry[] = [
  {
    id: "2",
    action: "updated",
    actorKind: "school_staff",
    actorName: "Maria Muster",
    changes: { name: { before: "Eingang", after: "Haupteingang" } },
    occurredAt: `${today}T14:05:00+02:00`,
  },
  {
    id: "1",
    action: "key_rotated",
    actorKind: "operator",
    actorName: null,
    changes: {},
    occurredAt: `${today}T09:30:00+02:00`,
  },
];

describe("DeviceHistoryList", () => {
  it("shows each change with who, when and the values before and after", () => {
    render(<DeviceHistoryList entries={entries} portal="school" />);

    const day = screen.getByRole("region", { name: "Heute" });
    expect(within(day).getByText("2 Änderungen")).toBeInTheDocument();
    expect(within(day).getByText("Angaben geändert")).toBeInTheDocument();
    expect(
      within(day).getByText("Name: Eingang → Haupteingang"),
    ).toBeInTheDocument();
    expect(
      within(day).getByText(/^Maria Muster · \d\d:\d\d Uhr$/),
    ).toBeInTheDocument();
    expect(within(day).getByText("Neuer Zugangsschlüssel")).toBeInTheDocument();
    expect(within(day).getByText(/^moto-Support · /)).toBeInTheDocument();
  });

  it("names the school to the operator only when the device changed schools", () => {
    const atOneSchool = entries.map((entry) => ({
      ...entry,
      schoolName: "OGS Burbach",
    }));
    const { unmount } = render(
      <DeviceHistoryList entries={atOneSchool} portal="operator" />,
    );
    expect(
      screen.getAllByText(/^Personal der Schule · \d\d:\d\d Uhr$/),
    ).toHaveLength(1);
    unmount();

    const moved = [
      { ...atOneSchool[0]!, schoolName: "OGS Walbach" },
      atOneSchool[1]!,
    ];
    render(<DeviceHistoryList entries={moved} portal="operator" />);
    expect(
      screen.getByText(/^Personal der Schule · OGS Walbach · /),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/^moto-Support · OGS Burbach · /),
    ).toBeInTheDocument();
  });

  it("says what will appear when nothing changed yet", () => {
    render(<DeviceHistoryList entries={[]} portal="school" />);

    expect(screen.getByText("Noch keine Änderungen")).toBeInTheDocument();
  });

  it("announces loading without showing an empty history", () => {
    render(<DeviceHistoryList entries={[]} portal="school" loading />);

    expect(
      screen.getByRole("status", { name: "Verlauf wird geladen" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Noch keine Änderungen")).not.toBeInTheDocument();
  });
});
