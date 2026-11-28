import { describe, expect, it } from "vitest";

import {
  describeRosterMaintenance,
  expiredSourceConnection,
} from "./roster-maintenance";
import type { TemplateRosterMaintenance } from "./timetable-types";

const base: TemplateRosterMaintenance = {
  mode: "manual",
  offeringNames: [],
  gradeLevels: [],
  schoolClasses: [],
  inactiveOfferingNames: [],
  invalidOfferingNames: ["Randstunde", "Musik"],
  expiredOfferings: [{ id: "3", name: "Randstunde" }],
  dynamicTargets: false,
  careOfferingsDisabled: false,
};

describe("roster maintenance of a source of an ended phase (#8203)", () => {
  it("names the expired offering once, apart from other invalid ones", () => {
    const { explanation } = describeRosterMaintenance(base);
    expect(explanation).toContain(
      "„Randstunde“ ist ein Angebot aus abgelaufener Phase. Neue Anmeldungen kommen hier nicht mehr an.",
    );
    expect(explanation).toContain(
      "Das Betreuungsangebot „Musik“ passt nicht zu diesem Regeltermin.",
    );
    expect(explanation).not.toContain("„Randstunde“ passt nicht");
  });

  it("offers no connection without an expired source", () => {
    expect(
      expiredSourceConnection({
        id: "7",
        rosterMaintenance: { ...base, expiredOfferings: [] },
      }),
    ).toBeNull();
  });
});
