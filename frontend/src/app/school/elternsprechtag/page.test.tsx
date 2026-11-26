import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testClockDay } from "~/test/clock";

vi.mock("vaul", () => import("~/test/mocks/vaul"));

const {
  mockUseSWRAuth,
  mockCreate,
  mockUpdate,
  mockReplace,
  mockMutate,
  mockSearch,
} = vi.hoisted(() => ({
  mockUseSWRAuth: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockReplace: vi.fn(),
  mockMutate: vi.fn(),
  mockSearch: { value: "" },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  usePathname: () => "/school/elternsprechtag",
  useSearchParams: () => new URLSearchParams(mockSearch.value),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { scope: "school" } },
    status: "authenticated",
  }),
}));
vi.mock("~/components/ui/date-picker", async () =>
  (await import("~/test/mocks/date-picker")).datePickerModuleMock(),
);
vi.mock("~/lib/swr", () => ({
  useSWRAuth: mockUseSWRAuth,
  // The read of the stored state after a refusal (ADR 0311).
  revalidateOrThrow: (read: { mutate: () => Promise<unknown> }) =>
    read.mutate(),
}));
vi.mock("~/lib/school-url", () => ({ schoolPath: (path: string) => path }));
vi.mock("~/lib/parent-conferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/parent-conferences")>()),
  fetchSchoolParentConferences: vi.fn(),
  createSchoolParentConference: mockCreate,
  updateSchoolParentConference: mockUpdate,
}));

import { ToastProvider } from "~/contexts/ToastContext";
import type { ParentConference } from "~/lib/parent-conferences";
import { ApiError } from "~/lib/api-error";
import SchoolParentConferencePage from "./page-content";

const day: ParentConference = {
  id: "5",
  school_class: "2a",
  date: "2026-11-12",
  start_time: "14:00",
  end_time: "14:30",
  slot_minutes: 15,
  breaks: [],
  location: "Raum 12",
  version: "v1",
  booked_count: 1,
  slots: [
    {
      start_time: "14:00",
      end_time: "14:15",
      booked: true,
      student_id: "9",
      student_name: "Mia Muster",
    },
    { start_time: "14:15", end_time: "14:30", booked: false },
  ],
};

function mockList(classes: string[], conferences: ParentConference[]) {
  mockUseSWRAuth.mockReturnValue({
    data: { classes, conferences },
    error: undefined,
    isLoading: false,
    mutate: mockMutate,
  });
}

function renderPage() {
  return render(<SchoolParentConferencePage />, { wrapper: ToastProvider });
}

describe("Elternsprechtag in moto schule (#4801)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSearch.value = "";
  });

  it("lists the own days with their occupancy", () => {
    mockList(["2a"], [day]);
    renderPage();
    expect(screen.getByText("Meine Elternsprechtage")).toBeInTheDocument();
    expect(screen.getAllByText("1 von 2").length).toBeGreaterThan(0);
  });

  it("shows who comes when on the chosen day, ready to print", () => {
    mockSearch.value = "sprechtag=5";
    mockList(["2a"], [day]);
    renderPage();
    expect(screen.getAllByText("Mia Muster").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Frei").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Drucken/ })).toBeInTheDocument();
  });

  // #7111: the day opened above the list while the focus stayed on the row.
  it("focuses the heading of the chosen day, and the list after it closes", () => {
    mockSearch.value = "sprechtag=5";
    mockList(["2a"], [day]);
    const { rerender } = renderPage();
    // A day named in the address on load is no step: the focus stays.
    const detail = screen.getByRole("heading", { name: /am 12\.11\.2026/ });
    expect(detail).not.toHaveFocus();

    mockSearch.value = "";
    rerender(<SchoolParentConferencePage />);
    expect(
      screen.getByRole("heading", { name: "Meine Elternsprechtage" }),
    ).toHaveFocus();

    mockSearch.value = "sprechtag=5";
    rerender(<SchoolParentConferencePage />);
    expect(
      screen.getByRole("heading", { name: /am 12\.11\.2026/ }),
    ).toHaveFocus();
  });

  it("offers no new day without an assigned class", () => {
    mockList([], []);
    renderPage();
    // Gesperrt mit Grund (#6757): aria-disabled, der Knopf nennt den Grund,
    // und ein Klick öffnet kein Formular.
    const create = screen.getByRole("button", {
      name: /Neuer Elternsprechtag/,
    });
    expect(create).toHaveAttribute("aria-disabled", "true");
    expect(create).toHaveAccessibleDescription(
      "Dafür brauchst du eine eigene Klasse, die OGS-Leitung ordnet sie zu.",
    );
    fireEvent.click(create);
    expect(screen.queryByLabelText("Tag")).toBeNull();
    expect(
      screen.getByText(/Dir ist keine Klasse zugeordnet/),
    ).toBeInTheDocument();
  });

  it("creates a day for the own class", async () => {
    mockList(["2a"], []);
    mockCreate.mockResolvedValue({ ...day, id: "6", booked_count: 0 });
    renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: /Neuer Elternsprechtag/ }),
    );
    // Ein Tag in der nächsten Woche; vergangene Tage lehnt das Formular ab.
    const nextWeek = testClockDay(7);
    fireEvent.change(screen.getByLabelText("Tag"), {
      target: { value: nextWeek },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate.mock.calls[0]?.[0]).toMatchObject({
      school_class: "2a",
      date: nextWeek,
      start_time: "14:00",
      end_time: "17:00",
      slot_minutes: 15,
      breaks: [],
    });
  });

  // ADR 0311: a family that booked after the Lehrkraft opened the change
  // must not lose its slot unseen. The change goes out on the day as read;
  // a refusal shows the stored day and saves on its version.
  it("changes a day on the version it was read at and shows the stored day after a refusal", async () => {
    const upcoming: ParentConference = { ...day, date: testClockDay(14) };
    const stored: ParentConference = {
      ...upcoming,
      location: "Aula",
      booked_count: 2,
      version: "v2",
    };
    let shown = upcoming;
    mockSearch.value = "sprechtag=5";
    mockUseSWRAuth.mockImplementation(() => ({
      data: { classes: ["2a"], conferences: [shown] },
      error: undefined,
      isLoading: false,
      mutate: mockMutate,
    }));
    mockMutate.mockImplementation(async () => {
      shown = stored;
      return { classes: ["2a"], conferences: [stored] };
    });
    mockUpdate
      .mockRejectedValueOnce(
        new ApiError("changed", 409, { code: "general.changed_since_read" }),
      )
      .mockResolvedValueOnce({ ...stored, version: "v3" });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Ändern" }));
    const room = screen.getByLabelText("Raum (freiwillig)");
    expect(room).toHaveValue("Raum 12");
    fireEvent.change(room, { target: { value: "Raum 14" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        "5",
        expect.objectContaining({ location: "Raum 14" }),
        "v1",
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Raum (freiwillig)")).toHaveValue("Aula"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenLastCalledWith(
        "5",
        expect.objectContaining({ location: "Aula" }),
        "v2",
      ),
    );
  });
});
