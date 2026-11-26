import { describe, expect, it } from "vitest";
import {
  pickupPersonChanged,
  pickupPersonInitialState,
  toPickupPersonSubmit,
} from "~/components/students/care-pickup-person-section";
import type { DayData } from "~/lib/pickup-schedule-helpers";
import {
  childChangeText,
  childSummaryCounts,
} from "~/components/home/day-changes-text";

const child = {
  studentId: "7",
  name: "Mia Klein",
  status: null,
  pickupTime: null,
  note: null,
};

function dayWith(pickupPerson: DayData["pickupPerson"]): DayData {
  return { pickupPerson } as DayData;
}

describe("pickup person of one day (#7655)", () => {
  it("starts from the stored day value", () => {
    expect(pickupPersonInitialState(null)).toEqual({
      choice: "regular",
      name: "",
    });
    expect(
      pickupPersonInitialState(
        dayWith({
          exceptionDate: "2026-11-26",
          name: "Berta Oma",
          guardianProfileId: "12",
          oneTime: false,
        }),
      ),
    ).toEqual({ choice: "contact:12", name: "" });
    expect(
      pickupPersonInitialState(
        dayWith({
          exceptionDate: "2026-11-26",
          name: "Tom Nachbar",
          oneTime: true,
        }),
      ),
    ).toEqual({ choice: "name", name: "Tom Nachbar" });
  });

  it("sends a contact, a trimmed name or the removal", () => {
    expect(toPickupPersonSubmit({ choice: "regular", name: "" })).toEqual({
      kind: "regular",
    });
    expect(toPickupPersonSubmit({ choice: "contact:12", name: "" })).toEqual({
      kind: "contact",
      guardianProfileId: "12",
    });
    expect(toPickupPersonSubmit({ choice: "name", name: "  Tom  " })).toEqual({
      kind: "name",
      name: "Tom",
    });
    // A one-time person without a name is not saved.
    expect(toPickupPersonSubmit({ choice: "name", name: "  " })).toBeNull();
  });

  it("does not re-save an untouched day", () => {
    const initial = { choice: "name", name: "Tom" };
    expect(pickupPersonChanged({ choice: "name", name: "Tom " }, initial)).toBe(
      false,
    );
    expect(pickupPersonChanged({ choice: "name", name: "Tim" }, initial)).toBe(
      true,
    );
    expect(pickupPersonChanged({ choice: "regular", name: "" }, initial)).toBe(
      true,
    );
  });

  it("names the person in Heute anders and asks for the ID card", () => {
    expect(
      childChangeText("child_pickup_person", {
        ...child,
        pickupPerson: { name: "Tom Nachbar", oneTime: true },
      }),
    ).toBe("Tom Nachbar holt Mia Klein heute ab. Bitte den Ausweis prüfen.");
    expect(
      childChangeText("child_pickup_person", {
        ...child,
        pickupPerson: { name: "Berta Oma", oneTime: false },
      }),
    ).toBe("Berta Oma holt Mia Klein heute ab.");
    expect(
      childSummaryCounts({
        schoolClass: "",
        counts: {
          sick: 0,
          excused: 0,
          pickupChanged: 0,
          goesAlone: 0,
          pickupNote: 0,
          pickupPerson: 2,
        },
        items: [],
      }),
    ).toBe("2 mit anderer Abholperson");
  });
});
