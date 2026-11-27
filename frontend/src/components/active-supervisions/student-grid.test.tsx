import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SupervisionStudentGrid } from "./student-grid";
import type { ActiveSupervisionStudent } from "./view-model";
import type { BulkPickupTime } from "~/lib/pickup-schedule-api";

// The hint „Gast aus …“ (#5630) loads in its own hook, tested in
// src/lib/hooks/use-holiday-guest-labels.test.tsx.
vi.mock("~/lib/hooks/use-holiday-guest-labels", () => ({
  useHolidayGuestLabels:
    () => (student: { id: string | number; school_class?: string | null }) =>
      student.school_class === "Feriengast"
        ? student.id === "8"
          ? "Gast aus OGS Am Park"
          : "Feriengast"
        : undefined,
}));

// #3889: without a block there is no list of expected or departed children,
// so the room's search only knows who is in the room. A miss must say so
// instead of looking like a broken search.
describe("SupervisionStudentGrid search miss (#3889)", () => {
  it("says the search only covers the children in the room", () => {
    const student = {
      id: "1",
      name: "Max Muster",
    } as unknown as ActiveSupervisionStudent;

    render(
      <SupervisionStudentGrid
        students={[student]}
        filteredStudents={[]}
        pickupTimesData={undefined}
        arrivalTimesData={undefined}
        trackingData={undefined}
        myGroupIds={[]}
        myGroupRooms={[]}
        now={new Date()}
        onOpenStudent={vi.fn()}
      />,
    );

    expect(screen.getByText("Keine Kinder gefunden")).toBeInTheDocument();
    expect(
      screen.getByText(/Gesucht wird nur unter den Kindern im Raum\./),
    ).toBeInTheDocument();
  });
});

// #3946: a one-day change of the Gehzeit or the Abholart marks the card.
describe("SupervisionStudentGrid one-day change (#3946)", () => {
  it("marks only the children whose way home changes today", () => {
    const changed = {
      id: "1",
      first_name: "Mia",
      second_name: "Schulz",
    } as unknown as ActiveSupervisionStudent;
    const usual = {
      id: "2",
      first_name: "Ben",
      second_name: "Kurz",
    } as unknown as ActiveSupervisionStudent;
    const modeChanged = {
      id: "3",
      first_name: "Lea",
      second_name: "Brandt",
    } as unknown as ActiveSupervisionStudent;
    const pickup = (
      studentId: string,
      isException: boolean,
      dayDepartureMode?: BulkPickupTime["dayDepartureMode"],
    ) =>
      ({
        studentId,
        date: "2026-09-09",
        weekdayName: "Mittwoch",
        pickupTime: "13:30",
        isException,
        dayDepartureMode,
        dayNotes: [],
      }) as BulkPickupTime;

    render(
      <SupervisionStudentGrid
        students={[changed, usual, modeChanged]}
        filteredStudents={[changed, usual, modeChanged]}
        pickupTimesData={
          new Map([
            ["1", pickup("1", true)],
            ["2", pickup("2", false)],
            ["3", pickup("3", false, "pickup")],
          ])
        }
        arrivalTimesData={undefined}
        trackingData={undefined}
        myGroupIds={[]}
        myGroupRooms={[]}
        now={new Date()}
        onOpenStudent={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", {
        // Named by what the card shows, name first (#7112).
        name: /^Mia Schulz .*Gehzeit heute geändert , Details öffnen$/,
      }),
    ).toHaveAttribute("data-day-home-change", "time");
    expect(
      screen.getByRole("button", {
        name: /^Lea Brandt .*Abholart heute geändert: Wird abgeholt , Details öffnen$/,
      }),
    ).toHaveAttribute("data-day-home-change", "mode");
    expect(
      screen.getByRole("button", {
        name: /^Ben Kurz .*Unbekannt , Details öffnen$/,
      }),
    ).not.toHaveAttribute("data-day-home-change");
  });
});

// #5630: a holiday guest names its home school where other children show
// their class.
describe("SupervisionStudentGrid holiday guest (#5630)", () => {
  it("shows the hint instead of the class Feriengast", () => {
    const guest = {
      id: "8",
      first_name: "Ben",
      second_name: "Muster",
      school_class: "Feriengast",
    } as unknown as ActiveSupervisionStudent;
    const own = {
      id: "9",
      first_name: "Lia",
      second_name: "Muster",
      school_class: "2a",
    } as unknown as ActiveSupervisionStudent;

    render(
      <SupervisionStudentGrid
        students={[guest, own]}
        filteredStudents={[guest, own]}
        pickupTimesData={undefined}
        arrivalTimesData={undefined}
        trackingData={undefined}
        myGroupIds={[]}
        myGroupRooms={[]}
        now={new Date()}
        onOpenStudent={vi.fn()}
      />,
    );

    expect(screen.getByText("Gast aus OGS Am Park")).toBeInTheDocument();
    expect(screen.getByText("2a")).toBeInTheDocument();
  });
});

// #8194: Die Angebote des Tages stehen auch auf den Karten der Aufsicht,
// zwischen Ankunft und Gehzeit, wie unter „Gruppen“.
describe("SupervisionStudentGrid planned offerings (#8194)", () => {
  it("lists a child's offerings between arrival and pickup", () => {
    const booked = {
      id: "1",
      first_name: "Mia",
      second_name: "Schulz",
      planned_activities: [
        { title: "Töpfer-AG", start_time: "14:00", end_time: "15:00" },
        { title: "Handball", start_time: "15:15", end_time: "16:00" },
      ],
    } as unknown as ActiveSupervisionStudent;
    const free = {
      id: "2",
      first_name: "Ben",
      second_name: "Kurz",
    } as unknown as ActiveSupervisionStudent;

    render(
      <SupervisionStudentGrid
        students={[booked, free]}
        filteredStudents={[booked, free]}
        pickupTimesData={
          new Map([
            [
              "1",
              {
                studentId: "1",
                date: "2026-09-09",
                weekdayName: "Mittwoch",
                pickupTime: "16:30",
                isException: false,
                dayNotes: [],
              } as BulkPickupTime,
            ],
          ])
        }
        arrivalTimesData={undefined}
        trackingData={undefined}
        myGroupIds={[]}
        myGroupRooms={[]}
        // 14:30 in Berlin, im Sommer.
        now={new Date("2026-09-09T14:30:00+02:00")}
        onOpenStudent={vi.fn()}
      />,
    );

    const lists = screen.getAllByRole("list", { name: "Angebote heute" });
    expect(lists).toHaveLength(1);
    const offerings = lists[0]!;
    expect(
      Array.from(offerings.querySelectorAll("li")).map(
        (item) => item.textContent,
      ),
    ).toEqual(["14:00–15:00 Töpfer-AG (läuft gerade)", "15:15–16:00 Handball"]);
    const pickup = screen.getByText(/Gehzeit: 16:30 Uhr/);
    expect(
      offerings.compareDocumentPosition(pickup) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(pickup.closest("[data-prominent]")).toHaveClass("font-semibold");
  });
});
