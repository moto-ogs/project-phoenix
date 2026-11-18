import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { computeStaffTriple, VertretungDayList } from "./vertretung-day-list";
import type { EnrichedInstance, GapInstance } from "~/lib/timetable-types";

const DAY = "2026-07-20";

function makeInstance(
  overrides: Partial<EnrichedInstance> & { id: string },
): EnrichedInstance {
  return {
    date: DAY,
    startTime: "09:00",
    endTime: "10:00",
    title: "Termin",
    status: "planned",
    isSpontaneous: false,
    isLive: false,
    activityType: "care",
    roomId: "1",
    roomName: "Raum 1",
    staff: [],
    studentIds: [],
    students: [],
    staffCount: 0,
    absentStaffCount: 0,
    expectedStudentsCount: 0,
    notScheduledStudentsCount: 0,
    presentStudentsCount: 0,
    requiredStaffCount: 0,
    assignedStaffCount: 0,
    conflictWarnings: [],
    ...overrides,
  };
}

function makeGap(
  overrides: Partial<GapInstance> & { instanceId: string },
): GapInstance {
  return {
    date: DAY,
    title: "Termin",
    startTime: "09:00",
    endTime: "10:00",
    roomId: "1",
    status: "planned",
    assignedStaffCount: 0,
    absentStaffCount: 0,
    ...overrides,
  };
}

// Bedingung 1: offene Lücke, unbesetzte
// Position ohne Ersatz. 09:00, damit die Sortierung mit der nächsten Fixture
// bei Gleichstand die Schwere prüft.
const gapInstance = makeInstance({
  id: "10",
  startTime: "09:00",
  endTime: "10:00",
  title: "Frühstück",
  staff: [
    {
      staffId: "1",
      isPrimary: true,
      isAbsent: true,
      isSubstitute: false,
      absenceReason: "krank",
    },
  ],
});

// Bedingung 4 ohne Bedingung 1: Abwesenheit mit gesetztem, deckendem Ersatz —
// die Störung bleibt sichtbar, zählt aber nicht mehr als offene Lücke.
// Gleiche Startzeit wie gapInstance für den Schwere-Test.
const coveredAbsenceInstance = makeInstance({
  id: "20",
  startTime: "09:00",
  endTime: "10:00",
  title: "Mittagessen",
  staff: [
    {
      staffId: "2",
      isPrimary: true,
      isAbsent: true,
      isSubstitute: false,
      absenceReason: "Fortbildung",
    },
    { staffId: "3", isPrimary: false, isAbsent: false, isSubstitute: true },
  ],
});

// Bedingung 2: quittierte (bewusst unbesetzte) Lücke.
const acknowledgedInstance = makeInstance({
  id: "30",
  startTime: "11:00",
  endTime: "12:00",
  title: "Hausaufgabenzeit",
  staff: [],
});

// Bedingung 3: abgesagter Block.
const cancelledInstance = makeInstance({
  id: "40",
  startTime: "13:00",
  endTime: "13:30",
  title: "Fußball",
  status: "cancelled",
  cancelReason: "Platz gesperrt",
  staff: [
    { staffId: "1", isPrimary: true, isAbsent: false, isSubstitute: false },
  ],
});

// Ungestörte Position — erscheint nur im Ganztags-Modus bzw. -Fallback.
const undisturbedInstance = makeInstance({
  id: "50",
  startTime: "14:00",
  endTime: "15:00",
  title: "Lesen",
  staff: [
    { staffId: "1", isPrimary: true, isAbsent: false, isSubstitute: false },
  ],
});

const allInstances = [
  gapInstance,
  coveredAbsenceInstance,
  acknowledgedInstance,
  cancelledInstance,
  undisturbedInstance,
];

const gaps: GapInstance[] = [
  makeGap({
    instanceId: "10",
    title: "Frühstück",
    startTime: "09:00",
    endTime: "10:00",
    assignedStaffCount: 0,
    absentStaffCount: 1,
    presentStaffCount: 0,
    plannedStaffCount: 1,
  }),
];

const acknowledged: GapInstance[] = [
  makeGap({
    instanceId: "30",
    title: "Hausaufgabenzeit",
    startTime: "11:00",
    endTime: "12:00",
    assignedStaffCount: 0,
    absentStaffCount: 1,
    presentStaffCount: 0,
    plannedStaffCount: 1,
    understaffedNote: "Personalengpass",
  }),
];

const staffNames = new Map<string, string>([
  ["1", "Anna Krause"],
  ["2", "Bernd Neu"],
  ["3", "Clara Fischer"],
  ["4", "David Voss"],
]);

describe("computeStaffTriple", () => {
  it("stimmt für eine offene Lücke mit den GapInstance-Zahlen überein", () => {
    expect(computeStaffTriple(gapInstance)).toEqual({
      planned: 1,
      present: 0,
      absent: 1,
    });
    expect(gaps[0]).toMatchObject({
      plannedStaffCount: 1,
      presentStaffCount: 0,
      absentStaffCount: 1,
    });
  });

  it("zählt eine deckende Vertretung als anwesend, die abwesende Person bleibt in 'absent'", () => {
    expect(computeStaffTriple(coveredAbsenceInstance)).toEqual({
      planned: 1,
      present: 1,
      absent: 1,
    });
  });
});

describe("VertretungDayList", () => {
  it("zeigt bei 'Nur Störungen' genau die vier gestörten Positionen", () => {
    render(
      <VertretungDayList
        title="Termine am Mi 09.09."
        instances={allInstances}
        gaps={gaps}
        acknowledged={acknowledged}
        gapsAvailable
        staffNames={staffNames}
        mode="stoerungen"
        canManage={false}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getByText("Frühstück")).toBeInTheDocument();
    expect(screen.getByText("Mittagessen")).toBeInTheDocument();
    expect(screen.getByText("Hausaufgabenzeit")).toBeInTheDocument();
    expect(screen.getByText("Fußball")).toBeInTheDocument();
    expect(screen.queryByText("Lesen")).not.toBeInTheDocument();
  });

  it("nennt je Zeile Raum, Gruppe und die eingeteilten Fachkräfte (#3817)", () => {
    const grouped = makeInstance({
      ...gapInstance,
      roomName: "Raum 104",
      groupName: "Sonne",
    });
    render(
      <VertretungDayList
        title="Termine am Mi 09.09."
        instances={[grouped]}
        gaps={gaps}
        acknowledged={[]}
        gapsAvailable
        staffNames={staffNames}
        mode="stoerungen"
        canManage={false}
        onEdit={vi.fn()}
      />,
    );

    const row = screen.getByTestId("vertretung-day-list-row-10");
    expect(within(row).getByText("Raum 104 · Sonne")).toBeInTheDocument();
    expect(within(row).getByText("Anna K.", { exact: false })).toHaveClass(
      "line-through",
    );
  });

  it("stellt offene Lücken vor das, was schon geregelt ist (#7493)", () => {
    // Die Abwesenheit mit Ersatz beginnt früher als die offene Lücke.
    const earlyCovered = makeInstance({
      id: "5",
      title: "Frühdienst",
      startTime: "06:30",
      endTime: "07:00",
      staff: [
        { staffId: "1", isPrimary: true, isAbsent: true, isSubstitute: false },
        { staffId: "3", isPrimary: false, isAbsent: false, isSubstitute: true },
      ],
    });
    render(
      <VertretungDayList
        title="Termine am Mi 09.09."
        instances={[earlyCovered, ...allInstances]}
        gaps={gaps}
        acknowledged={acknowledged}
        gapsAvailable
        staffNames={staffNames}
        mode="stoerungen"
        canManage={false}
        onEdit={vi.fn()}
      />,
    );

    const headings = () =>
      screen
        .queryAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent);
    const ids = () =>
      screen
        .getAllByTestId(/vertretung-day-list-row-/)
        .map((row) =>
          row.dataset.testid?.replace("vertretung-day-list-row-", ""),
        );
    expect(headings()).toEqual(["Offene Lücken", "Schon geregelt"]);
    expect(ids()).toEqual(["10", "5", "20", "30", "40"]);
  });

  it("zeigt bei 'Ganzer Tag' den Tag nach Uhrzeit, ohne Gruppen", () => {
    const earlyCovered = makeInstance({
      id: "5",
      title: "Frühdienst",
      startTime: "06:30",
      endTime: "07:00",
      staff: [
        { staffId: "1", isPrimary: true, isAbsent: true, isSubstitute: false },
        { staffId: "3", isPrimary: false, isAbsent: false, isSubstitute: true },
      ],
    });
    render(
      <VertretungDayList
        title="Termine am Mi 09.09."
        instances={[...allInstances, earlyCovered]}
        gaps={gaps}
        acknowledged={acknowledged}
        gapsAvailable
        staffNames={staffNames}
        mode="ganzer-tag"
        canManage={false}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.queryAllByRole("heading", { level: 3 })).toEqual([]);
    const ids = screen
      .getAllByTestId(/vertretung-day-list-row-/)
      .map((row) =>
        row.dataset.testid?.replace("vertretung-day-list-row-", ""),
      );
    expect(ids).toEqual(["5", "10", "20", "30", "40", "50"]);
  });

  it("verspricht kein 'Besetzen', wenn für die Lücke niemand eingeteilt ist", () => {
    const unstaffed = makeInstance({
      id: "70",
      title: "Fußball-AG",
      startTime: "15:00",
      endTime: "16:00",
      staff: [],
    });
    render(
      <VertretungDayList
        title="Termine am Mi 09.09."
        instances={[unstaffed]}
        gaps={[
          makeGap({
            instanceId: "70",
            title: "Fußball-AG",
            startTime: "15:00",
            endTime: "16:00",
            assignedStaffCount: 0,
            absentStaffCount: 0,
            presentStaffCount: 0,
            plannedStaffCount: 0,
          }),
        ]}
        acknowledged={[]}
        gapsAvailable
        staffNames={staffNames}
        mode="stoerungen"
        canManage
        onEdit={vi.fn()}
      />,
    );

    const row = screen.getByTestId("vertretung-day-list-row-70");
    // Offen bleibt die Lücke, aber die Zeile sagt, was fehlt und wo man es
    // behebt, statt „0/0“ und „Besetzen“.
    expect(within(row).getByText("Niemand eingeteilt")).toBeInTheDocument();
    expect(
      within(row).getByText("Personal trägst du im Betreuungsplan ein."),
    ).toBeInTheDocument();
    expect(within(row).queryByText(/Soll 0/)).not.toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: /^Bearbeiten: Fußball-AG/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Besetzen/ }),
    ).not.toBeInTheDocument();
  });

  it("sortiert in einer Gruppe nach Startzeit, bei Gleichstand nach Schwere", () => {
    render(
      <VertretungDayList
        title="Termine am Mi 09.09."
        instances={allInstances}
        gaps={gaps}
        acknowledged={acknowledged}
        gapsAvailable
        staffNames={staffNames}
        mode="stoerungen"
        canManage={false}
        onEdit={vi.fn()}
      />,
    );

    const rows = screen.getAllByTestId(/vertretung-day-list-row-/);
    const ids = rows.map((row) =>
      row.dataset.testid?.replace("vertretung-day-list-row-", ""),
    );
    expect(ids).toEqual(["10", "20", "30", "40"]);
  });

  it("fällt bei einem störungsfreien Tag automatisch auf die Ganztagsdarstellung zurück", () => {
    render(
      <VertretungDayList
        title="Termine am Mi 09.09."
        instances={[undisturbedInstance]}
        gaps={[]}
        acknowledged={[]}
        gapsAvailable
        staffNames={staffNames}
        mode="stoerungen"
        canManage={false}
        onEdit={vi.fn()}
      />,
    );

    expect(
      screen.getByText("An diesem Tag ist keine Lücke offen"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Wie geplant" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Lesen")).toBeInTheDocument();
  });

  it("nennt als Ergebnis den nächsten Tag mit offenen Lücken und führt dorthin", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <VertretungDayList
        title="Termine am Mi 09.09."
        instances={[undisturbedInstance]}
        gaps={[]}
        acknowledged={[]}
        gapsAvailable
        nextOpenDay={{ label: "Do 10.09.", count: 2, onSelect }}
        staffNames={staffNames}
        mode="stoerungen"
        canManage
        onEdit={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Am Do 10.09. sind noch 2 Lücken offen."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Do 10.09. zeigen" }));
    expect(onSelect).toHaveBeenCalledTimes(1);

    rerender(
      <VertretungDayList
        title="Termine am Mi 09.09."
        instances={[undisturbedInstance]}
        gaps={[]}
        acknowledged={[]}
        gapsAvailable
        nextOpenDay={null}
        staffNames={staffNames}
        mode="stoerungen"
        canManage
        onEdit={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Auch sonst ist in dieser Woche keine Lücke offen."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /zeigen$/ }),
    ).not.toBeInTheDocument();
  });

  it("zeigt kein Ergebnis, solange eine Lücke offen ist", () => {
    render(
      <VertretungDayList
        title="Termine am Mi 09.09."
        instances={allInstances}
        gaps={gaps}
        acknowledged={acknowledged}
        gapsAvailable
        nextOpenDay={null}
        staffNames={staffNames}
        mode="stoerungen"
        canManage
        onEdit={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Offene Lücken" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("An diesem Tag ist keine Lücke offen"),
    ).not.toBeInTheDocument();
  });

  it("zeigt einen schlichten Empty-State ohne Instanzen", () => {
    render(
      <VertretungDayList
        title="Termine am Mi 09.09."
        instances={[]}
        gaps={[]}
        acknowledged={[]}
        gapsAvailable
        staffNames={staffNames}
        mode="stoerungen"
        canManage={false}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getByText("Keine Termine an diesem Tag")).toBeInTheDocument();
  });

  it("zeigt Ersatzkräfte blockweit statt sie abwesenden Personen zuzuordnen", () => {
    const multipleAbsences = makeInstance({
      id: "60",
      title: "Ausflug",
      staff: [
        { staffId: "1", isPrimary: true, isAbsent: true, isSubstitute: false },
        { staffId: "2", isPrimary: false, isAbsent: true, isSubstitute: false },
        { staffId: "3", isPrimary: false, isAbsent: false, isSubstitute: true },
      ],
    });
    render(
      <VertretungDayList
        title="Termine am Mi 09.09."
        instances={[gapInstance, multipleAbsences]}
        gaps={[]}
        acknowledged={[]}
        gapsAvailable
        staffNames={staffNames}
        mode="ganzer-tag"
        canManage={false}
        onEdit={vi.fn()}
      />,
    );

    const uncoveredRow = screen.getByTestId("vertretung-day-list-row-10");
    expect(
      within(uncoveredRow).getByText("Ersatzkräfte: keine"),
    ).toBeInTheDocument();

    const coveredRow = screen.getByTestId("vertretung-day-list-row-60");
    expect(
      within(coveredRow).getByText("Ersatzkräfte: Clara Fischer"),
    ).toBeInTheDocument();
    expect(within(coveredRow).queryByText(/Ersatz:/)).not.toBeInTheDocument();
  });

  it("entwarnt und fällt ohne verfügbare Lückendaten nicht auf den ganzen Tag zurück", () => {
    render(
      <VertretungDayList
        title="Termine am Mi 09.09."
        instances={[undisturbedInstance]}
        gaps={[]}
        acknowledged={[]}
        gapsAvailable={false}
        staffNames={staffNames}
        mode="stoerungen"
        canManage={false}
        onEdit={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Störungslage konnte nicht vollständig geprüft werden"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("An diesem Tag ist keine Lücke offen"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Offene Lücken" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Lesen")).not.toBeInTheDocument();
  });

  it("zeigt ohne Lückendaten den Hinweis des Aufrufers und nur, was die Termine selbst sagen", () => {
    render(
      <VertretungDayList
        title="Termine am Mi 09.09."
        instances={allInstances}
        gaps={[]}
        acknowledged={[]}
        gapsAvailable={false}
        gapsNotice={<p>Der Tag ist vorbei.</p>}
        staffNames={staffNames}
        mode="stoerungen"
        canManage={false}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getByText("Der Tag ist vorbei.")).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Störungslage konnte nicht vollständig geprüft werden",
      ),
    ).not.toBeInTheDocument();
    // Abwesenheit und Absage stehen in den Terminen selbst; was nur die
    // Lückendaten wissen (quittiert, offen), behauptet die Liste nicht.
    const ids = screen
      .getAllByTestId(/vertretung-day-list-row-/)
      .map((row) =>
        row.dataset.testid?.replace("vertretung-day-list-row-", ""),
      );
    expect(ids).toEqual(["10", "20", "40"]);
    expect(screen.queryAllByRole("heading", { level: 3 })).toEqual([]);
  });

  it("sagt Lesenutzern, wer Vertretungen einträgt", () => {
    const { rerender } = render(
      <VertretungDayList
        title="Termine am Mi 09.09."
        instances={allInstances}
        gaps={gaps}
        acknowledged={acknowledged}
        gapsAvailable
        staffNames={staffNames}
        mode="stoerungen"
        canManage={false}
        onEdit={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Termine am Mi 09.09." }),
    ).toBeInTheDocument();
    const hint = "Nur zur Ansicht. Vertretungen trägt die Leitung ein.";
    expect(screen.getByText(hint)).toBeInTheDocument();

    rerender(
      <VertretungDayList
        title="Termine am Mi 09.09."
        instances={allInstances}
        gaps={gaps}
        acknowledged={acknowledged}
        gapsAvailable
        staffNames={staffNames}
        mode="stoerungen"
        canManage
        onEdit={vi.fn()}
      />,
    );
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
  });

  it("löst onEdit mit der Instanz-ID aus: 'Besetzen' an der offenen Lücke, sonst 'Bearbeiten', ohne canManage 'Details'", () => {
    const onEdit = vi.fn();
    const { rerender } = render(
      <VertretungDayList
        title="Termine am Mi 09.09."
        instances={allInstances}
        gaps={gaps}
        acknowledged={acknowledged}
        gapsAvailable
        staffNames={staffNames}
        mode="stoerungen"
        canManage
        onEdit={onEdit}
      />,
    );

    // Die offene Lücke nennt das Ergebnis des Klicks, der Name der Zeile
    // gehört zum vorgelesenen Namen des Knopfs.
    const row = screen.getByTestId("vertretung-day-list-row-10");
    fireEvent.click(
      within(row).getByRole("button", { name: /^Besetzen: Frühstück/ }),
    );
    expect(onEdit).toHaveBeenCalledWith("10");
    const settledRow = screen.getByTestId("vertretung-day-list-row-20");
    fireEvent.click(
      within(settledRow).getByRole("button", { name: /^Bearbeiten: / }),
    );
    expect(onEdit).toHaveBeenLastCalledWith("20");

    rerender(
      <VertretungDayList
        title="Termine am Mi 09.09."
        instances={allInstances}
        gaps={gaps}
        acknowledged={acknowledged}
        gapsAvailable
        staffNames={staffNames}
        mode="stoerungen"
        canManage={false}
        onEdit={onEdit}
      />,
    );

    // Lesenutzer behalten ein Klickziel (unterhalb lg gibt es keine
    // Kalenderspalte; der Verlauf muss ohne schedules:manage lesbar bleiben) —
    // aber nicht unter dem irreführenden Label "Bearbeiten".
    expect(
      screen.queryByRole("button", { name: /^(Bearbeiten|Besetzen)/ }),
    ).not.toBeInTheDocument();
    const readOnlyRow = screen.getByTestId("vertretung-day-list-row-10");
    fireEvent.click(
      within(readOnlyRow).getByRole("button", { name: /^Details: / }),
    );
    expect(onEdit).toHaveBeenLastCalledWith("10");
  });
});
