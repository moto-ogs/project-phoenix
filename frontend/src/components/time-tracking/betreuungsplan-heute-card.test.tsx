import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "~/lib/api-error";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import type { OwnAssignment } from "~/lib/shift-helpers";
import { setTestClock, testClockDay } from "~/test/clock";
import { catalogText } from "~/test/error-catalog-text";

import { TodayAssignmentsCard } from "./betreuungsplan-heute-card";

const today = testClockDay();

function assignment(overrides: Partial<OwnAssignment> = {}): OwnAssignment {
  return {
    instanceId: "1",
    date: today,
    startTime: "13:00",
    endTime: "14:00",
    title: "Lernzeit",
    groupName: "Mondgruppe",
    roomName: "OGS-Raum 1",
    status: "planned",
    cancelled: false,
    isPrimary: true,
    absenceReason: null,
    cancelReason: null,
    isAbsent: false,
    isSubstitute: false,
    understaffedAck: false,
    ...overrides,
  };
}

describe("TodayAssignmentsCard", () => {
  it("zeigt einen laufenden Einsatz ohne Uhrzeit-Status oder Link", () => {
    setTestClock(`${today}T12:30:00Z`);
    render(
      <TodayAssignmentsCard
        today={today}
        assignments={[assignment({ endTime: "15:00" })]}
        failed={false}
        error={null}
      />,
    );

    expect(screen.getByText("13:00–15:00")).toBeInTheDocument();
    expect(screen.getByText(/Lernzeit/)).toBeInTheDocument();
    expect(screen.getByText("· Mondgruppe")).toBeInTheDocument();
    expect(screen.getByText("OGS-Raum 1")).toBeInTheDocument();
    expect(screen.queryByText("Läuft")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("zeigt alle heutigen Einsätze nach Uhrzeit im Raster", () => {
    render(
      <TodayAssignmentsCard
        today={today}
        assignments={[
          assignment({
            instanceId: "1",
            startTime: "15:00",
            title: "Freispiel",
          }),
          assignment({
            instanceId: "2",
            startTime: "08:00",
            title: "Frühdienst",
          }),
          assignment({
            instanceId: "3",
            startTime: "11:00",
            title: "Mittagessen",
          }),
          assignment({ instanceId: "4" }),
          assignment({
            instanceId: "5",
            date: testClockDay(1),
            title: "Morgen",
          }),
        ]}
        failed={false}
        error={null}
      />,
    );

    expect(screen.getByRole("list").className).toContain("grid-cols");
    const tiles = screen.getAllByRole("listitem");
    expect(tiles).toHaveLength(4);
    expect(tiles[0]).toHaveTextContent("Frühdienst");
    expect(tiles[1]).toHaveTextContent("Mittagessen");
    expect(tiles[2]).toHaveTextContent("Lernzeit");
    expect(tiles[3]).toHaveTextContent("Freispiel");
  });

  it("blendet die Karte ohne Einsätze aus", () => {
    const { container } = render(
      <TodayAssignmentsCard
        today={today}
        assignments={[]}
        failed={false}
        error={null}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("unterscheidet einen Ladefehler von einem leeren Tag", async () => {
    const failure = new ApiError("boom", 500, {
      code: "general.server",
      instance: "req-plan",
    });
    const retry = vi.fn();

    function FailedAssignmentsCard() {
      const error = useSwrLoadError(
        failure,
        "die Liste deiner Einsätze",
        retry,
      );
      return <TodayAssignmentsCard today={today} failed error={error} />;
    }
    render(<FailedAssignmentsCard />);

    expect(
      await screen.findByText(
        catalogText("general.server", "die Liste deiner Einsätze"),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Vorgangskennung kopieren/ }),
    ).toHaveTextContent("req-plan");
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    expect(retry).toHaveBeenCalled();
  });
});
