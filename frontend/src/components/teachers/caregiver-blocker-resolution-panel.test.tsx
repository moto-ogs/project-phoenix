import {
  fireEvent,
  render as renderRaw,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "~/lib/api-error";
import { SWRConfig } from "~/lib/swr/testing";
import { catalogText } from "~/test/error-catalog-text";
import { CaregiverBlockerResolutionPanel } from "./caregiver-blocker-resolution-panel";

const { mockToastSuccess, mockGetAllAvailableStaff, mockFetch } = vi.hoisted(
  () => ({
    mockToastSuccess: vi.fn(),
    mockGetAllAvailableStaff: vi.fn(),
    mockFetch: vi.fn(),
  }),
);

vi.unmock("swr");

// A signed-in session for the shared cache; global fetch stays the test's.
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "1", scope: "tenant" }, expires: "2099-01-01" },
    status: "authenticated",
  }),
}));

function render(ui: ReactNode) {
  return renderRaw(
    <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
      {ui}
    </SWRConfig>,
  );
}

vi.mock("~/components/ui/alert", async () => {
  const { createElement } = await import("react");

  return {
    Alert: ({ message }: { message?: string }) =>
      message
        ? createElement("div", { "data-testid": "alert" }, message)
        : null,
  };
});

vi.mock("~/components/ui/info-section", async () => {
  const { createElement } = await import("react");

  return {
    InfoSection: ({
      title,
      children,
    }: {
      title: string;
      children: ReactNode;
    }) =>
      createElement(
        "section",
        null,
        createElement("h2", null, title),
        children,
      ),
  };
});

vi.mock("~/contexts/ToastContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/contexts/ToastContext")>()),
  useToast: () => ({
    success: mockToastSuccess,
  }),
}));

vi.mock("~/lib/staff-role-api", () => ({
  fetchGroupLeaderCandidates: mockGetAllAvailableStaff,
}));

vi.mock("~/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

global.fetch = mockFetch as unknown as typeof fetch;

vi.mock("~/lib/session-cache", async (importOriginal) => {
  const plain = await import("~/test/mocks/plain-session-fetch");
  return {
    ...(await importOriginal<typeof import("~/lib/session-cache")>()),
    requireTenantSession: plain.requireTenantSession,
    renewTenantSession: plain.renewTenantSession,
  };
});

/** A successful write without data, as the catalog proxy hands it on. */
function noData() {
  return {
    ok: true,
    json: () => Promise.resolve({ status: "success", data: null }),
  };
}

function createState(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "42",
    email: "teacher@example.com",
    firstName: "Ada",
    lastName: "Lovelace",
    personId: "10",
    staffId: "20",
    teacherId: "30",
    hasAdminRole: true,
    hasUserRole: true,
    hasPerson: true,
    hasStaff: true,
    hasTeacher: true,
    hasCaregiverProfile: true,
    isActiveCaregiver: true,
    disableBlocked: true,
    disableBlockers: ["Aktive Gruppenaufsicht"],
    activeSupervisions: [],
    activeSubstitutions: [],
    activitySupervisions: [],
    groupAssignments: [],
    ...overrides,
  };
}

describe("CaregiverBlockerResolutionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllAvailableStaff.mockResolvedValue([
      { id: "20", fullName: "Current Caregiver", teacherId: "30" },
      { id: "21", fullName: "Other Caregiver", teacherId: "32" },
    ]);
  });

  it("loads available staff and excludes the current caregiver from replacements", async () => {
    render(
      <CaregiverBlockerResolutionPanel
        active
        state={createState({
          activitySupervisions: [
            {
              id: "1",
              activityId: "11",
              activityName: "Theater",
              isPrimary: true,
            },
          ],
        })}
      />,
    );

    await waitFor(() => {
      expect(mockGetAllAvailableStaff).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("combobox"));

    expect(
      screen.queryByRole("option", { name: "Current Caregiver" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Other Caregiver" }),
    ).toBeInTheDocument();
  });

  it("shows when replacement staff cannot be loaded", async () => {
    mockGetAllAvailableStaff.mockRejectedValueOnce(
      new ApiError("invalid data", 503, { code: "general.unavailable" }),
    );

    render(<CaregiverBlockerResolutionPanel active state={createState()} />);

    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die Liste der Ersatzkräfte"),
      ),
    ).toBeInTheDocument();
  });

  it("confirms ending an active supervision before calling the API", async () => {
    mockFetch.mockResolvedValue(noData());

    render(
      <CaregiverBlockerResolutionPanel
        active
        state={createState({
          activeSupervisions: [
            { id: "7", groupName: "Gruppe Blau", startDate: "2026-04-05" },
          ],
        })}
      />,
    );

    // Ausgangszustand: die Aufsicht steht in der Liste.
    expect(screen.getByText("Gruppe Blau")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Beenden"));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "Gruppenaufsicht beenden?" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Aufsicht beenden" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/active/supervisors/7/end",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByText("Gruppe Blau")).not.toBeInTheDocument();
    });
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Die Gruppenaufsicht für „Gruppe Blau“ ist beendet.",
    );
  });

  it("ends group handovers and reports success", async () => {
    mockFetch.mockResolvedValue(noData());

    render(
      <CaregiverBlockerResolutionPanel
        active
        state={createState({
          activeSubstitutions: [
            {
              id: "9",
              groupName: "Gruppe Rot",
              startDate: "2026-04-05",
              endDate: "2026-04-06",
            },
          ],
        })}
      />,
    );

    // #3109: ending a handover asks first (ConfirmationModal).
    fireEvent.click(screen.getByRole("button", { name: "Beenden" }));
    expect(mockFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Übergabe beenden" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/substitutions/end",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ type: "group_handover", id: "9" }),
        }),
      );
    });
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Die Gruppenübergabe für „Gruppe Rot“ ist beendet.",
    );
  });

  it("transfers activity supervision to a replacement caregiver", async () => {
    mockFetch.mockResolvedValue(noData());

    render(
      <CaregiverBlockerResolutionPanel
        active
        state={createState({
          activitySupervisions: [
            {
              id: "8",
              activityId: "12",
              activityName: "Theater",
              isPrimary: true,
            },
          ],
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("combobox")).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Other Caregiver" }));
    fireEvent.click(screen.getByRole("button", { name: /^Aktionen für/ }));
    expect(
      screen.queryByRole("menuitem", { name: "Entfernen" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Übertragen" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/activities/12/supervisors/8?replacement_staff_id=21",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Die Leitung von „Theater“ ist übertragen.",
    );
  });

  it("shows the dedicated only-supervisor error when activity removal is rejected", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      text: async () =>
        JSON.stringify({
          error: "cannot remove the only supervisor",
          code: "timetable.only_supervisor_replacement_required",
        }),
    });

    render(
      <CaregiverBlockerResolutionPanel
        active
        state={createState({
          activitySupervisions: [
            {
              id: "8",
              activityId: "12",
              activityName: "Theater",
              isPrimary: true,
            },
          ],
        })}
      />,
    );

    // #3109: removing without a replacement asks first (ConfirmDeleteModal).
    fireEvent.click(screen.getByRole("button", { name: /^Aktionen für/ }));
    expect(
      screen.queryByRole("menuitem", { name: "Übertragen" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Entfernen" }));
    expect(mockFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ja, entfernen" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Ohne Ersatz entfernen" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("alert")).toHaveTextContent(
        catalogText(
          "timetable.only_supervisor_replacement_required",
          "die Leitung von „Theater“",
        ),
      );
    });
  });

  it("falls back to the generic activity error message for unstructured failures", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "<html>gateway</html>",
    });

    render(
      <CaregiverBlockerResolutionPanel
        active
        state={createState({
          activitySupervisions: [
            {
              id: "8",
              activityId: "12",
              activityName: "Theater",
              isPrimary: true,
            },
          ],
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Aktionen für/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Entfernen" }));
    fireEvent.click(screen.getByRole("button", { name: "Ja, entfernen" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Ohne Ersatz entfernen" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("alert")).toHaveTextContent(
        catalogText("general.server", "die Leitung von „Theater“"),
      );
    });
  });

  it("preserves other group leaders when removing a Stammgruppe assignment", async () => {
    mockFetch.mockResolvedValue(noData());

    render(
      <CaregiverBlockerResolutionPanel
        active
        state={createState({
          groupAssignments: [
            {
              id: "10",
              groupId: "14",
              groupName: "Gruppe Gelb",
              teacherId: "30",
              teacherIds: ["30", "31"],
            },
          ],
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Aktionen für/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Entfernen" }));
    expect(mockFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ja, entfernen" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Ohne Ersatz entfernen" }),
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/groups/14",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ name: "Gruppe Gelb", teacher_ids: ["31"] }),
        }),
      );
    });
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Die Gruppenleitung für „Gruppe Gelb“ ist entfernt.",
    );
  });

  it("preserves other group leaders when reassigning a Stammgruppe", async () => {
    mockFetch.mockResolvedValue(noData());

    render(
      <CaregiverBlockerResolutionPanel
        active
        state={createState({
          groupAssignments: [
            {
              id: "10",
              groupId: "14",
              groupName: "Gruppe Gelb",
              teacherId: "30",
              teacherIds: ["30", "31"],
            },
          ],
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("combobox")).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Other Caregiver" }));
    fireEvent.click(screen.getByRole("button", { name: /^Aktionen für/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Übertragen" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/groups/14",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({
            name: "Gruppe Gelb",
            teacher_ids: ["31", "32"],
          }),
        }),
      );
    });
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Die Gruppenleitung für „Gruppe Gelb“ ist übertragen.",
    );
  });

  it("weist auf den Rückweg hin, sobald nichts mehr offen ist", () => {
    render(<CaregiverBlockerResolutionPanel active state={createState()} />);

    expect(
      screen.getByText(
        "Alle Zuordnungen wurden aufgelöst. Gehe zurück zur Übersicht, um die Betreuung zu deaktivieren.",
      ),
    ).toBeInTheDocument();
  });
});
