import { describe, it, expect } from "vitest";
import { mapVisitsToSupervisionStudents } from "~/components/active-supervisions/view-model";
import { mapStudentListRow } from "./student-wire";
import { mapSupervisionDashboard } from "./supervision-dashboard-wire";
import { buildSupervisionDashboardWire } from "~/test/fixtures/supervision-dashboard";

// Die Angebote des Tages (#6487) stehen seit #8194 auf jeder Kinderkarte:
// Gruppen, Alle Kinder und Aktuelle Aufsicht. Hier: der Weg vom Draht zum
// Kind für die beiden neuen Listen.

const pottery = { title: "Töpfer-AG", start_time: "14:00", end_time: "15:00" };
const handball = { title: "Handball", start_time: "15:15", end_time: "16:00" };

describe("planned activities on the child", () => {
  it("reach the card in „Alle Kinder“ from the slim list", () => {
    const row = {
      id: "7",
      first_name: "Ida",
      last_name: "Angebot",
      school_class: "4a",
      current_location: "Anwesend",
      sick: false,
      excused: false,
      class_trip: false,
      has_full_access: true,
    };

    expect(
      mapStudentListRow(
        { ...row, planned_activities: [pottery] } as Parameters<
          typeof mapStudentListRow
        >[0],
        "slim",
      ).planned_activities,
    ).toEqual([pottery]);
    expect(mapStudentListRow(row, "slim").planned_activities).toBeUndefined();
  });

  it("keep child and order on the way out of the supervision dashboard", () => {
    const data = mapSupervisionDashboard(
      buildSupervisionDashboardWire({
        planned_activities: [
          { student_id: "7", ...pottery },
          { student_id: "7", ...handball },
          { student_id: "8", ...handball },
        ],
      }),
    );

    expect(data.plannedActivities).toEqual([
      { studentId: "7", ...pottery },
      { studentId: "7", ...handball },
      { studentId: "8", ...handball },
    ]);
    // Eine ältere Antwort ohne das Feld bleibt lesbar.
    expect(
      mapSupervisionDashboard(
        buildSupervisionDashboardWire({ planned_activities: null }),
      ).plannedActivities,
    ).toEqual([]);
  });

  it("reach the supervision card of the child they are for", () => {
    const [ida, bruno] = mapVisitsToSupervisionStudents(
      [
        {
          studentId: "7",
          studentName: "Ida Angebot",
          activeGroupId: "a1",
          checkInTime: "2026-09-07T08:00:00.000Z",
          isActive: true,
        },
        {
          studentId: "8",
          studentName: "Bruno Banknachbar",
          activeGroupId: "a1",
          checkInTime: "2026-09-07T08:00:00.000Z",
          isActive: true,
        },
      ],
      { plannedActivities: new Map([["7", [pottery, handball]]]) },
    );

    expect(ida?.planned_activities).toEqual([pottery, handball]);
    expect(bruno?.planned_activities).toBeUndefined();
  });
});
