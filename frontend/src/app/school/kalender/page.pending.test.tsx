// #6593: Während der Schultermin gespeichert wird, lässt sich das Panel
// nicht schließen; eine späte Antwort zeigt keinen Fehler mehr.
import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deferred,
  expectSlideOverSaveLocked,
  expectSlideOverUnlocked,
} from "~/test/helpers/form-modal-pending";
import { TEST_CLOCK_TODAY, testClockDay } from "~/test/clock";

// Wie page.test.tsx: echter Übersetzungskontext aus dem Schul-Guard.
vi.unmock("next-intl");
vi.mock("next/navigation", () => ({
  usePathname: () => "/school/kalender",
  redirect: vi.fn(),
}));
vi.mock("~/lib/school-url", () => ({ schoolPath: (path: string) => path }));
vi.mock("~/lib/shell-auth-context", () => ({
  SchoolShellProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("~/components/school/shell/school-shell", () => ({
  SchoolShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("~/components/school/school-realtime-bridge", () => ({
  SchoolRealtimeBridge: () => null,
}));
vi.mock("~/components/tenant/pwa-install-hint", () => ({
  PwaInstallHint: () => null,
}));
vi.mock("~/components/notifications/portal-notification-setup", () => ({
  PortalNotificationSetup: () => null,
}));
vi.mock("~/components/ui/date-picker", async () =>
  (await import("~/test/mocks/date-picker")).datePickerModuleMock(),
);
vi.mock("vaul", () => import("~/test/mocks/vaul"));

const {
  mockUseSWRAuth,
  mockCreateSchoolAppointment,
  mockUpdateSchoolAppointment,
  mockToastSuccess,
  mockMutate,
} = vi.hoisted(() => ({
  mockUseSWRAuth: vi.fn(),
  mockCreateSchoolAppointment: vi.fn(),
  mockUpdateSchoolAppointment: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockMutate: vi.fn(),
}));

vi.mock("~/lib/swr", () => ({ useSWRAuth: mockUseSWRAuth }));
vi.mock("~/contexts/ToastContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/contexts/ToastContext")>()),
  useToast: () => ({
    success: mockToastSuccess,
    error: vi.fn(),
    warning: vi.fn(),
  }),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { scope: "school" } },
    status: "authenticated",
  }),
}));
vi.mock("~/lib/personal-calendar-api", async () => {
  const actual = await vi.importActual<
    typeof import("~/lib/personal-calendar-api")
  >("~/lib/personal-calendar-api");
  return {
    ...actual,
    getSchoolCalendar: vi.fn(),
    createSchoolAppointment: mockCreateSchoolAppointment,
    updateSchoolAppointment: mockUpdateSchoolAppointment,
    deleteSchoolAppointment: vi.fn(),
    respondSchoolCalendar: vi.fn(),
  };
});

import { ToastProvider } from "~/contexts/ToastContext";
import { unavailableApiError } from "~/lib/api-error";
import type { SchoolCalendarResponse } from "~/lib/personal-calendar-api";

import { SchoolAuthGuard } from "../auth-guard";
import SchoolCalendarPage from "./page";

const FOOTER = ["Abbrechen", "Speichert…"];

function render(ui: ReactElement) {
  return rtlRender(<SchoolAuthGuard>{ui}</SchoolAuthGuard>, {
    wrapper: ToastProvider,
  });
}

// Wochentag des Testtags, Montag = 0.
const [year = 0, month = 1, day = 1] = TEST_CLOCK_TODAY.split("-").map(Number);
const WEEKDAY = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
// Montag der Woche des Testtags: die Wochenansicht blendet das Wochenende aus.
const MONDAY = testClockDay(-WEEKDAY);

// Die Woche des Testtags mit dem Termin an ihrem Montag.
const data: SchoolCalendarResponse = {
  from: MONDAY,
  to: testClockDay(6 - WEEKDAY),
  events: [
    {
      id: `appointment:3:${MONDAY}`,
      source: "appointment",
      appointment_id: "3",
      title: "Zoo-Ausflug",
      start_date: MONDAY,
      end_date: MONDAY,
      start_time: "08:30",
      end_time: "12:00",
      all_day: false,
      school_event_type: "ausflug",
      can_respond: false,
      can_edit: true,
    },
  ],
  closing_days: [],
  holidays: [],
  classes: ["3b"],
};

async function startCreating() {
  const answer = deferred<unknown>();
  mockCreateSchoolAppointment.mockReturnValue(answer.promise);
  const view = render(<SchoolCalendarPage />);
  fireEvent.click(screen.getByRole("button", { name: "Neuer Termin" }));
  fireEvent.change(screen.getByLabelText("Titel"), {
    target: { value: "Wandertag" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
  await screen.findByRole("button", { name: "Speichert…" });
  return { ...view, answer };
}

describe("Schulkalender: Speichern sperrt das Panel (#6593)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSWRAuth.mockImplementation(() => ({
      data,
      error: null,
      isLoading: false,
      mutate: mockMutate,
    }));
    mockMutate.mockResolvedValue(undefined);
  });

  it("locks the panel while saving and unlocks it with the error after a failure", async () => {
    const { answer } = await startCreating();

    expectSlideOverSaveLocked("Schultermin anlegen", FOOTER);

    await act(async () => {
      answer.reject(unavailableApiError(new TypeError("Failed to fetch")));
    });

    expect(
      await screen.findByRole("button", { name: /Wiederholen/ }),
    ).toBeInTheDocument();
    expectSlideOverUnlocked("Schultermin anlegen");
    expect(screen.getByLabelText("Titel")).toHaveValue("Wandertag");
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("closes the panel and refreshes the calendar after saving", async () => {
    const { answer } = await startCreating();

    await act(async () => {
      answer.resolve({});
    });

    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Der Termin „Wandertag“ ist gespeichert.",
    );
    expect(mockMutate).toHaveBeenCalledOnce();
    // Anker: die Kalenderseite ist wieder bedienbar.
    expect(screen.getByRole("button", { name: "Neuer Termin" })).toBeEnabled();
    expect(
      screen.queryByRole("heading", { name: "Schultermin anlegen" }),
    ).toBeNull();
  });

  it("still refreshes an edit whose answer arrives after unmount", async () => {
    const answer = deferred<unknown>();
    mockUpdateSchoolAppointment.mockReturnValue(answer.promise);
    const { unmount } = render(<SchoolCalendarPage />);
    fireEvent.click(screen.getAllByRole("button", { name: /Zoo-Ausflug/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await screen.findByRole("button", { name: "Speichert…" });
    expectSlideOverSaveLocked("Schultermin bearbeiten", FOOTER);

    unmount();
    await act(async () => {
      answer.resolve({});
    });

    expect(mockUpdateSchoolAppointment).toHaveBeenCalledWith(
      "3",
      expect.objectContaining({ title: "Zoo-Ausflug" }),
    );
    expect(mockToastSuccess).toHaveBeenCalledOnce();
    expect(mockMutate).toHaveBeenCalledOnce();
  });
});
