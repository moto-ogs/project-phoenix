import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { childChangeText } from "~/components/home/day-changes-text";
import { CarePickupPersonSection } from "~/components/students/care-pickup-person-section";
import { PickupPersonRow } from "~/components/students/pickup-person-row";
import type { DayData } from "~/lib/pickup-schedule-helpers";
import { pickupWithdrawalMessage } from "~/lib/pickup-withdrawal";

// A pickup person whose pickup permission no longer holds on the day is never
// shown as a valid pickup person (#8206).
describe("withdrawn pickup permission (#8206)", () => {
  it("says on the child card that the person may not collect", () => {
    const { rerender } = render(
      <PickupPersonRow
        person={{
          name: "Oma Berta",
          oneTime: false,
          permissionWithdrawn: true,
        }}
      />,
    );
    expect(screen.getByText("Abholerlaubnis entzogen:")).toBeInTheDocument();
    expect(
      screen.getByText(/Oma Berta darf heute nicht abholen\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Holt heute ab/)).not.toBeInTheDocument();

    rerender(
      <PickupPersonRow person={{ name: "Oma Berta", oneTime: false }} />,
    );
    expect(screen.getByText(/Holt heute ab: Oma Berta/)).toBeInTheDocument();
  });

  it("names the withdrawal in the day's changes", () => {
    expect(
      childChangeText("child_pickup_person", {
        studentId: "7",
        name: "Mia Klein",
        status: null,
        pickupTime: null,
        note: null,
        pickupPerson: {
          name: "Oma Berta",
          oneTime: false,
          permissionWithdrawn: true,
        },
      }),
    ).toBe(
      "Oma Berta darf Mia Klein heute nicht abholen. Die Abholerlaubnis ist entzogen.",
    );
  });

  it("asks for another person in the day editor and keeps the choices", () => {
    const day = {
      weekday: 2,
      pickupPerson: {
        exceptionDate: "2026-09-08",
        name: "Oma Berta",
        guardianProfileId: "12",
        oneTime: false,
        permissionWithdrawn: true,
      },
    } as DayData;
    render(
      <CarePickupPersonSection
        pickupDay={day}
        draft={{ choice: "contact:12", name: "" }}
        onDraftChange={() => undefined}
        guardians={[]}
      />,
    );
    expect(
      screen.getByText(
        "Die Abholerlaubnis von Oma Berta gilt an diesem Tag nicht mehr. Wähl eine andere Person.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Andere Person" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Wie immer" })).toBeEnabled();
  });

  it("names the removed days after the withdrawal", () => {
    expect(
      pickupWithdrawalMessage("Oma Berta", ["2026-09-08", "2026-09-10"]),
    ).toBe(
      "Die Angaben von Oma Berta sind gespeichert. Oma Berta darf nicht mehr abholen. Diese Abholtage sind entfernt: 08.09.2026, 10.09.2026.",
    );
    expect(pickupWithdrawalMessage("Oma Berta", ["2026-09-08"])).toBe(
      "Die Angaben von Oma Berta sind gespeichert. Oma Berta darf nicht mehr abholen. Dieser Abholtag ist entfernt: 08.09.2026.",
    );
  });
});
