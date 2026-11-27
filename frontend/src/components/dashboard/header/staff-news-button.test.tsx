import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { PickupChangeNotice } from "~/lib/pickup-change-notices-api";
import type { StudentNoteTeamNotice } from "~/lib/student-notes-api";
import { testClockDay } from "~/test/clock";

const mockNotes = vi.fn();
const mockPickups = vi.fn();
vi.mock("~/lib/hooks/use-student-note-team-notices", () => ({
  useStudentNoteTeamNotices: () => mockNotes(),
}));
vi.mock("~/lib/hooks/use-pickup-change-notices", () => ({
  usePickupChangeNotices: () => mockPickups(),
}));
vi.mock("~/lib/tenant-path", () => ({
  useTenantAwarePath: () => (path: string) => `/schule${path}`,
}));

import { StaffNewsButton, staffNewsItems } from "./staff-news-button";

function note(
  over: Partial<StudentNoteTeamNotice> = {},
): StudentNoteTeamNotice {
  return {
    noteId: "11",
    studentId: "7",
    studentFirstName: "Mia",
    studentLastName: "Muster",
    authorName: "Sara Betreuerin",
    informedAt: "2026-09-09T10:00:00Z",
    ...over,
  };
}

function pickup(over: Partial<PickupChangeNotice> = {}): PickupChangeNotice {
  return {
    requestId: "21",
    studentId: "8",
    studentFirstName: "Noa",
    date: testClockDay(1),
    pickupTime: "15:00",
    pickupPerson: "",
    withdrawn: false,
    informedAt: "2026-09-09T11:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockNotes.mockReturnValue({ notices: [] });
  mockPickups.mockReturnValue({ notices: [] });
});

// „Neu für Sie“ (#6854, #6855): one red count for the shared notes and the
// changed pickup times; it is there exactly while one of them waits, and
// each row opens the child, where it clears.
describe("StaffNewsButton", () => {
  it("shows nothing while nothing waits", () => {
    const { container } = render(<StaffNewsButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it("counts notes and pickup changes together and links each to the child", () => {
    mockNotes.mockReturnValue({ notices: [note()] });
    mockPickups.mockReturnValue({
      notices: [
        pickup(),
        pickup({
          requestId: "22",
          studentId: "9",
          studentFirstName: "Ida",
          date: testClockDay(2),
          pickupTime: "",
          withdrawn: true,
        }),
      ],
    });
    render(<StaffNewsButton />);

    const button = screen.getByRole("button", {
      name: "Neu für dich 3 ungelesen",
    });
    expect(screen.getByText("3")).toBeInTheDocument();
    fireEvent.click(button);

    const mia = screen.getByRole("link", { name: /Mia Muster/ });
    expect(mia).toHaveAttribute("href", "/schule/students/7?tab=notizen");
    expect(mia).toHaveTextContent("Notiz von Sara Betreuerin");

    // The pickup rows name the child by first name only and open the child.
    const noa = screen.getByRole("link", { name: /Noa/ });
    expect(noa).toHaveAttribute("href", "/schule/students/8");
    expect(noa).toHaveTextContent("Morgen: neue Abholzeit 15:00 Uhr");
    const ida = screen.getByRole("link", { name: /Ida/ });
    expect(ida).toHaveTextContent("wieder normale Abholzeit");
  });

  // #8162: a family named who collects the child.
  it("names the pickup person a family asked for", () => {
    mockNotes.mockReturnValue({ notices: [] });
    mockPickups.mockReturnValue({
      notices: [
        pickup({ pickupTime: "", pickupPerson: "Tante Frieda" }),
        pickup({
          requestId: "23",
          studentFirstName: "Ida",
          pickupPerson: "Oma Berta",
        }),
      ],
    });
    render(<StaffNewsButton />);
    fireEvent.click(screen.getByRole("button", { name: /Neu für dich/ }));

    expect(screen.getByRole("link", { name: /Noa/ })).toHaveTextContent(
      "Morgen: Tante Frieda holt ab",
    );
    expect(screen.getByRole("link", { name: /Ida/ })).toHaveTextContent(
      "Morgen: neue Abholzeit 15:00 Uhr, Oma Berta holt ab",
    );
  });

  it("names a withdrawn pickup person without changing the regular pickup time", () => {
    mockPickups.mockReturnValue({
      notices: [
        pickup({
          pickupTime: "",
          pickupPerson: "Tante Frieda",
          withdrawn: true,
        }),
      ],
    });
    render(<StaffNewsButton />);
    fireEvent.click(screen.getByRole("button", { name: /Neu für dich/ }));

    expect(screen.getByRole("link", { name: /Noa/ })).toHaveTextContent(
      "Morgen: Abholperson zurückgenommen",
    );
  });

  it("names both withdrawn pickup changes", () => {
    mockPickups.mockReturnValue({
      notices: [pickup({ pickupPerson: "Tante Frieda", withdrawn: true })],
    });
    render(<StaffNewsButton />);
    fireEvent.click(screen.getByRole("button", { name: /Neu für dich/ }));

    expect(screen.getByRole("link", { name: /Noa/ })).toHaveTextContent(
      "Morgen: Abholzeit und Abholperson zurückgenommen",
    );
  });
});

describe("staffNewsItems", () => {
  it("lists both kinds newest first", () => {
    const items = staffNewsItems(
      [note({ informedAt: "2026-09-09T09:00:00Z" })],
      [pickup({ informedAt: "2026-09-09T12:00:00Z" })],
    );
    expect(items.map((item) => item.kind)).toEqual(["pickup", "note"]);
  });
});
