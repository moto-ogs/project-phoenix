import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { expiredSourceConnection } from "~/lib/roster-maintenance";
import type { TemplateRosterMaintenance } from "~/lib/timetable-types";

import { SeriesRosterReview } from "./series-roster-review";

const maintenance: TemplateRosterMaintenance = {
  mode: "manual",
  offeringNames: [],
  gradeLevels: [],
  schoolClasses: [],
  inactiveOfferingNames: [],
  invalidOfferingNames: ["Randstunde"],
  expiredOfferings: [
    {
      id: "3",
      name: "Randstunde",
      successor: { id: "13", name: "Randstunde" },
    },
  ],
  dynamicTargets: false,
  careOfferingsDisabled: false,
};

describe("SeriesRosterReview with a source of an ended phase (#8203)", () => {
  it("names the old offering and connects with the new one", () => {
    const connection = expiredSourceConnection({
      id: "7",
      rosterMaintenance: maintenance,
      sourceGradeLevels: [2],
    });
    const onConnect = vi.fn();
    render(
      <SeriesRosterReview
        manualRosterConfirmed={false}
        expiredSources={maintenance.expiredOfferings}
        expiredConnection={connection}
        onConnect={onConnect}
      />,
    );

    expect(
      screen.getByText("Angebot aus abgelaufener Phase"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "„Randstunde“ gehört zu einer Anmeldephase, die vorbei ist. Neue Anmeldungen kommen hier nicht mehr an. Passend ist „Randstunde“ aus der aktuellen Phase.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Mit neuem Angebot verbinden" }),
    );
    expect(onConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: "7",
        offerings: [{ id: "13", name: "Randstunde" }],
        gradeLevels: [2],
      }),
    );
  });

  it("asks for the offering when no successor fits and hides the button without rights", () => {
    const expired = [{ id: "3", name: "Randstunde" }];
    const connection = expiredSourceConnection({
      id: "7",
      rosterMaintenance: { ...maintenance, expiredOfferings: expired },
    });
    render(
      <SeriesRosterReview
        manualRosterConfirmed={false}
        expiredSources={expired}
        expiredConnection={connection}
      />,
    );

    expect(
      screen.getByText(/Wähle beim Verbinden das neue Angebot aus\./),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mit neuem Angebot verbinden" }),
    ).not.toBeInTheDocument();
    expect(connection?.offerings).toEqual([]);
  });
});
