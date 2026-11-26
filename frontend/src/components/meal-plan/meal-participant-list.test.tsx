import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setTestClock } from "~/test/clock";
import { preloadDayPicker } from "~/components/ui/lazy-day-picker";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";
import deMessages from "~/i18n/messages/de.generated";

// Real next-intl: the cutoff texts use ICU plurals the global mock cannot
// render.
vi.unmock("next-intl");

// Echtes SWR statt des globalen Stubs, mit frischem Cache je Render.
vi.unmock("swr");

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "account-1", tenantId: "1", scope: "tenant" } },
    status: "authenticated",
  }),
}));

const mocks = vi.hoisted(() => ({
  getDailyMealParticipants: vi.fn(),
  downloadDailyMealParticipants: vi.fn(),
  getChildMealSchedule: vi.fn(),
  setChildMealDay: vi.fn(),
  clearChildMealDay: vi.fn(),
  replaceChildMealSchedule: vi.fn(),
  getWeeklyMealParticipants: vi.fn(),
  downloadWeeklyMealParticipants: vi.fn(),
  today: "2026-09-07",
}));

vi.mock("~/lib/meal-plan-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/meal-plan-api")>()),
  getDailyMealParticipants: mocks.getDailyMealParticipants,
  downloadDailyMealParticipants: mocks.downloadDailyMealParticipants,
  getChildMealSchedule: mocks.getChildMealSchedule,
  setChildMealDay: mocks.setChildMealDay,
  clearChildMealDay: mocks.clearChildMealDay,
  replaceChildMealSchedule: mocks.replaceChildMealSchedule,
  getWeeklyMealParticipants: mocks.getWeeklyMealParticipants,
  downloadWeeklyMealParticipants: mocks.downloadWeeklyMealParticipants,
}));

vi.mock("~/lib/hooks/use-berlin-today", () => ({
  useBerlinToday: () => mocks.today,
}));

import { ToastProvider } from "~/contexts/ToastContext";
import { SWRConfig } from "~/lib/swr/testing";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";
import { useSWRAuth } from "~/lib/swr";
import { tenantContactKeys } from "~/lib/swr/tenant-contact-keys";
import { deferred } from "~/test/helpers/form-modal-pending";
import { MealRegistrationChangeModal } from "./meal-registration-change-modal";
import { MealParticipantList } from "./meal-participant-list";

function render(ui: ReactElement) {
  return rtlRender(ui, {
    wrapper: ({ children }) => (
      <NextIntlClientProvider
        locale="de"
        messages={deMessages}
        timeZone="Europe/Berlin"
      >
        <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
          <ToastProvider>{children}</ToastProvider>
        </SWRConfig>
      </NextIntlClientProvider>
    ),
  });
}

/**
 * The list next to a reader of the week's meal orders: a registration change
 * reloads them. Returns the orders' fetcher.
 */
function renderWithOrderWeek() {
  const readOrders = vi.fn(() => Promise.resolve(null));
  function OrderWeek() {
    useSWRAuth(
      tenantContactKeys.mealOrders("2026-09-07", "2026-09-11"),
      readOrders,
    );
    return null;
  }
  render(
    <>
      <MealParticipantList canRegister />
      <OrderWeek />
    </>,
  );
  return readOrders;
}

/** The download menu stays disabled until the list has loaded. */
async function openDownloadMenu() {
  const download = await screen.findByRole("button", {
    name: "Tagesliste herunterladen",
  });
  await waitFor(() => expect(download).toBeEnabled());
  fireEvent.click(download);
}

/**
 * Opens the change dialog from the head. The button stays disabled until the
 * participants have loaded, so a click before that does nothing.
 */
async function openChangeFromHead() {
  const changeRegistration = await screen.findByRole("button", {
    name: "Anmeldung ändern",
  });
  await waitFor(() => expect(changeRegistration).toBeEnabled());
  fireEvent.click(changeRegistration);
  return screen.findByRole("dialog");
}

// The kit loads the calendar grid lazily; load it once up front so a cold
// import on a busy machine does not race the findBy timeout.
beforeAll(() => preloadDayPicker());

describe("MealParticipantList", () => {
  beforeEach(() => {
    // Keep the calendar's "today" label independent of the actual CI date.
    setTestClock(new Date("2026-09-07T12:00:00+02:00"));
    vi.clearAllMocks();
    mocks.today = "2026-09-07";
    mocks.getDailyMealParticipants.mockResolvedValue({
      date: "2026-09-07",
      cutoffTime: "09:00",
      deadline: "2026-09-04T07:00:00Z",
      closed: false,
      participants: [
        {
          studentId: "42",
          firstName: "Mia",
          lastName: "Muster",
          schoolClass: "2a",
        },
      ],
      others: [
        {
          studentId: "43",
          firstName: "Ben",
          lastName: "Bauer",
          schoolClass: "3b",
        },
      ],
    });
    mocks.getChildMealSchedule.mockResolvedValue({
      weekdays: [1, 3],
      effectiveFrom: "2026-09-01",
      version: "v-read",
    });
    mocks.setChildMealDay.mockResolvedValue(undefined);
    mocks.clearChildMealDay.mockResolvedValue(undefined);
    mocks.replaceChildMealSchedule.mockResolvedValue(undefined);
  });

  it.each(["date", "child"] as const)(
    "drops an edited draft when the %s selection changes and returns",
    async (selection) => {
      mocks.getChildMealSchedule
        .mockReset()
        .mockResolvedValueOnce({ weekdays: [1, 3], version: "v-first" })
        .mockResolvedValueOnce({ weekdays: [4], version: "v-other" })
        .mockResolvedValue({ weekdays: [1, 3], version: "v-first" });
      render(
        <MealRegistrationChangeModal
          isOpen
          date="2026-09-07"
          participants={[
            {
              studentId: "42",
              firstName: "Mia",
              lastName: "Muster",
              schoolClass: "2a",
            },
          ]}
          others={[
            {
              studentId: "43",
              firstName: "Ben",
              lastName: "Bauer",
              schoolClass: "3b",
            },
          ]}
          initialStudentId="42"
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Feste Tage" }));
      await waitFor(() =>
        expect(screen.getByRole("checkbox", { name: "Montag" })).toBeChecked(),
      );
      fireEvent.click(screen.getByRole("checkbox", { name: "Dienstag" }));
      expect(screen.getByRole("checkbox", { name: "Dienstag" })).toBeChecked();
      async function selectOther(back: boolean) {
        if (selection === "date") {
          fireEvent.click(
            // The trigger is named by its label and its date (#6800).
            screen.getByRole("button", {
              name: `Gilt ab: ${back ? "14.09.2026" : "07.09.2026"}`,
            }),
          );
          fireEvent.click(
            await screen.findByRole("button", {
              name: back
                ? /Montag, 7\. September 2026/
                : "Montag, 14. September 2026",
            }),
          );
        } else {
          fireEvent.click(screen.getByRole("combobox", { name: "Kind" }));
          fireEvent.click(
            await screen.findByRole("option", {
              name: back
                ? "Muster, Mia · 2a · Isst mit"
                : "Bauer, Ben · 3b · Isst nicht mit",
            }),
          );
        }
      }
      await selectOther(false);
      await waitFor(() =>
        expect(
          screen.getByRole("checkbox", { name: "Donnerstag" }),
        ).toBeChecked(),
      );
      // Back on the first selection, its stored days show again (from the
      // shared cache) and the edit made before is gone.
      await selectOther(true);
      await waitFor(() =>
        expect(screen.getByRole("checkbox", { name: "Montag" })).toBeChecked(),
      );
      expect(
        screen.getByRole("checkbox", { name: "Dienstag" }),
      ).not.toBeChecked();
      fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
      await waitFor(() =>
        expect(mocks.replaceChildMealSchedule).toHaveBeenCalledWith(
          "42",
          [1, 3],
          "2026-09-07",
          "v-first",
        ),
      );
    },
  );

  it("keeps saving locked until the regular days have loaded", async () => {
    const first = deferred<{ weekdays: number[]; version: string }>();
    mocks.getChildMealSchedule.mockReturnValueOnce(first.promise);
    render(
      <MealRegistrationChangeModal
        isOpen
        date="2026-09-07"
        participants={[
          {
            studentId: "42",
            firstName: "Mia",
            lastName: "Muster",
            schoolClass: "2a",
          },
        ]}
        others={[]}
        initialStudentId="42"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Feste Tage" }));
    expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(mocks.replaceChildMealSchedule).not.toHaveBeenCalled();
    await act(async () => first.reject(new ApiError("offline", 503)));
    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die festen Tage"),
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Montag" })).toBeDisabled();
    mocks.getChildMealSchedule.mockResolvedValue({
      weekdays: [2, 4],
      version: "v-retried",
    });
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Dienstag" })).toBeChecked(),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Freitag" }));
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(mocks.replaceChildMealSchedule).toHaveBeenCalledWith(
        "42",
        [2, 4, 5],
        "2026-09-07",
        "v-retried",
      ),
    );
  });

  // ADR 0311: the save carries the version of the regular days as read. A
  // colleague's or a parent's change since is refused; the dialog then shows
  // the stored days instead of the edit and offers no retry of the request.
  it("shows the stored regular days when they changed since they were read", async () => {
    mocks.getChildMealSchedule
      .mockReset()
      .mockResolvedValueOnce({ weekdays: [1, 3], version: "v-read" })
      .mockResolvedValue({ weekdays: [2, 4], version: "v-stored" });
    mocks.replaceChildMealSchedule.mockRejectedValueOnce(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
    const onSaved = vi.fn();
    render(
      <MealRegistrationChangeModal
        isOpen
        date="2026-09-07"
        participants={[
          {
            studentId: "42",
            firstName: "Mia",
            lastName: "Muster",
            schoolClass: "2a",
          },
        ]}
        others={[]}
        initialStudentId="42"
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Feste Tage" }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Montag" })).toBeChecked(),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Freitag" }));
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    const refusal = await screen.findByText(
      catalogText("general.changed_since_read", "die Anmeldung"),
    );
    expect(mocks.replaceChildMealSchedule).toHaveBeenCalledWith(
      "42",
      [1, 3, 5],
      "2026-09-07",
      "v-read",
    );
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Dienstag" })).toBeChecked(),
    );
    expect(screen.getByRole("checkbox", { name: "Freitag" })).not.toBeChecked();
    const alert = refusal.closest<HTMLElement>('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(
      within(alert!).queryByRole("button", { name: "Wiederholen" }),
    ).not.toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  // ADR 0311: the days keep the version they were edited on. A read of the
  // schedule in the background (another view) must not lend its newer
  // version to the edited days.
  it("sends the version the days were edited on, not a later read's", async () => {
    mocks.getChildMealSchedule
      .mockReset()
      .mockResolvedValueOnce({ weekdays: [1, 3], version: "v-read" })
      .mockResolvedValue({ weekdays: [2], version: "v-later" });
    const scheduleKey = tenantContactKeys.childMealSchedule("42", "2026-09-07");
    let readAgain: () => Promise<unknown> = async () => undefined;
    function OtherView() {
      const other = useSWRAuth(
        scheduleKey,
        () => mocks.getChildMealSchedule("42", "2026-09-07"),
        { revalidateOnMount: false },
      );
      readAgain = () => other.mutate();
      return null;
    }
    render(
      <>
        <MealRegistrationChangeModal
          isOpen
          date="2026-09-07"
          participants={[
            {
              studentId: "42",
              firstName: "Mia",
              lastName: "Muster",
              schoolClass: "2a",
            },
          ]}
          others={[]}
          initialStudentId="42"
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
        <OtherView />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Feste Tage" }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Montag" })).toBeChecked(),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Freitag" }));
    await act(async () => {
      await readAgain();
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(mocks.replaceChildMealSchedule).toHaveBeenCalledWith(
        "42",
        [1, 3, 5],
        "2026-09-07",
        "v-read",
      ),
    );
  });

  it("shows a failed reload after a refusal as a load error", async () => {
    mocks.getChildMealSchedule
      .mockReset()
      .mockResolvedValueOnce({ weekdays: [1, 3], version: "v-read" })
      .mockRejectedValue(
        new ApiError("offline", 503, { code: "general.unavailable" }),
      );
    mocks.replaceChildMealSchedule.mockRejectedValueOnce(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
    render(
      <MealRegistrationChangeModal
        isOpen
        date="2026-09-07"
        participants={[
          {
            studentId: "42",
            firstName: "Mia",
            lastName: "Muster",
            schoolClass: "2a",
          },
        ]}
        others={[]}
        initialStudentId="42"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Feste Tage" }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Montag" })).toBeChecked(),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Freitag" }));
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(/Der neue Stand konnte nicht geladen werden/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Du siehst jetzt den neuen Stand/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();
  });

  it("names a failed opening read over cached regular days and saves nothing", async () => {
    mocks.getChildMealSchedule
      .mockReset()
      .mockResolvedValueOnce({ weekdays: [1, 3], version: "v-read" })
      .mockRejectedValueOnce(
        new ApiError("offline", 503, { code: "general.unavailable" }),
      )
      .mockResolvedValueOnce({ weekdays: [2], version: "v-new" });
    const modal = (isOpen: boolean) => (
      <MealRegistrationChangeModal
        isOpen={isOpen}
        date="2026-09-07"
        participants={[
          {
            studentId: "42",
            firstName: "Mia",
            lastName: "Muster",
            schoolClass: "2a",
          },
        ]}
        others={[]}
        initialStudentId="42"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    const { rerender } = render(modal(true));
    fireEvent.click(screen.getByRole("button", { name: "Feste Tage" }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Montag" })).toBeChecked(),
    );
    rerender(modal(false));
    rerender(modal(true));
    fireEvent.click(screen.getByRole("button", { name: "Feste Tage" }));

    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die festen Tage"),
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Dienstag" })).toBeChecked(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(mocks.replaceChildMealSchedule).toHaveBeenCalledWith(
        "42",
        [2],
        expect.any(String),
        "v-new",
      ),
    );
  });

  // #3873: seeing the list opens no change of a registration.
  it("offers no change and loads no other children without the right to register", async () => {
    render(<MealParticipantList canRegister={false} />);

    await screen.findByText("Mittagessen am 07.09.2026");
    expect(mocks.getDailyMealParticipants).toHaveBeenCalledWith(
      "2026-09-07",
      false,
    );
    // Anker: die Zeile des Kindes ist geladen.
    expect((await screen.findAllByText("Muster, Mia")).length).toBeGreaterThan(
      0,
    );
    expect(
      screen.queryByRole("button", { name: "Anmeldung ändern" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Aktionen für Mia Muster" }),
    ).not.toBeInTheDocument();
  });

  it("allows registration without exposing exports", async () => {
    render(<MealParticipantList canRegister canExport={false} />);
    // Anker: die Tagesliste zeigt ein geladenes Kind.
    expect((await screen.findAllByText("Muster, Mia"))[0]).toBeInTheDocument();
    expect(mocks.getDailyMealParticipants).toHaveBeenCalledWith(
      "2026-09-07",
      true,
    );
    expect(
      await screen.findByRole("button", { name: "Anmeldung ändern" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Woche" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Tagesliste herunterladen" }),
    ).not.toBeInTheDocument();
  });

  it("starts on Monday and disables weekends when opened on a weekend", async () => {
    mocks.today = "2026-09-05";

    render(<MealParticipantList canRegister />);

    await waitFor(() => {
      expect(mocks.getDailyMealParticipants).toHaveBeenCalledWith(
        "2026-09-07",
        true,
      );
    });
    const datePicker = screen.getByRole("button", {
      name: "Datum: 07.09.2026",
    });
    fireEvent.click(datePicker);

    // The kit loads the calendar grid lazily.
    expect(
      await screen.findByRole("button", {
        name: "Samstag, 12. September 2026",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Sonntag, 13. September 2026" }),
    ).toBeDisabled();
  });

  it("advances the default list when the Berlin date changes", async () => {
    const { rerender } = render(<MealParticipantList canRegister />);

    await waitFor(() => {
      expect(mocks.getDailyMealParticipants).toHaveBeenCalledWith(
        "2026-09-07",
        true,
      );
    });

    mocks.today = "2026-09-08";
    rerender(<MealParticipantList canRegister />);

    await waitFor(() => {
      expect(mocks.getDailyMealParticipants).toHaveBeenCalledWith(
        "2026-09-08",
        true,
      );
    });
    expect(
      screen.getByRole("button", { name: "Datum: 08.09.2026" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Mittagessen am 08.09.2026")).toBeInTheDocument();
  });

  it("keeps a manually selected list across a Berlin date change", async () => {
    const { rerender } = render(<MealParticipantList canRegister />);

    await screen.findByText("Mittagessen am 07.09.2026");
    fireEvent.click(screen.getByRole("button", { name: "Datum: 07.09.2026" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Mittwoch, 9. September 2026",
      }),
    );
    await waitFor(() => {
      expect(mocks.getDailyMealParticipants).toHaveBeenCalledWith(
        "2026-09-09",
        true,
      );
    });

    mocks.today = "2026-09-08";
    rerender(<MealParticipantList canRegister />);

    expect(
      screen.getByRole("button", { name: "Datum: 09.09.2026" }),
    ).toBeInTheDocument();
    expect(mocks.getDailyMealParticipants).not.toHaveBeenCalledWith(
      "2026-09-08",
    );
  });

  it("shows the kitchen cutoff and registered children", async () => {
    render(<MealParticipantList canRegister />);

    expect(
      // #3873: the deadline of the day, here the Friday before.
      await screen.findByText(
        "Bestellfrist für diesen Tag: Fr., 04.09., 09:00.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Muster, Mia").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2a").length).toBeGreaterThan(0);
    expect(screen.getByText("Mittagessen am 07.09.2026")).toBeInTheDocument();
    expect(
      screen.queryByText("Mittagessen am 2026-09-07"),
    ).not.toBeInTheDocument();
    expect(mocks.getDailyMealParticipants).toHaveBeenCalledWith(
      "2026-09-07",
      true,
    );
    const datePicker = screen.getByRole("button", {
      name: "Datum: 07.09.2026",
    });
    expect(datePicker).toBeInTheDocument();
    expect(datePicker).toHaveClass("h-10", "min-w-44", "rounded-lg");
    expect(
      document.querySelector('input[type="date"]'),
    ).not.toBeInTheDocument();

    fireEvent.click(datePicker);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Dienstag, 8. September 2026",
      }),
    );
    await waitFor(() => {
      expect(mocks.getDailyMealParticipants).toHaveBeenCalledWith(
        "2026-09-08",
        true,
      );
    });
    expect(
      screen.getByRole("button", { name: "Datum: 08.09.2026" }),
    ).toBeInTheDocument();
  });

  // #4748: ein Export ohne Optionen steht im Menü, ein Eintrag pro Format.
  it("offers PDF and Excel in one download menu", async () => {
    let finishPdf: () => void = () => undefined;
    mocks.downloadDailyMealParticipants
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishPdf = resolve;
        }),
      )
      .mockResolvedValueOnce(undefined);
    render(<MealParticipantList canRegister />);

    await openDownloadMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "PDF" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "PDF wird heruntergeladen.",
    );
    await waitFor(() => {
      expect(mocks.downloadDailyMealParticipants).toHaveBeenCalledWith(
        "2026-09-07",
        "pdf",
      );
    });
    finishPdf();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(""),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Tagesliste herunterladen" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Excel" }));
    await waitFor(() => {
      expect(mocks.downloadDailyMealParticipants).toHaveBeenCalledWith(
        "2026-09-07",
        "xlsx",
      );
    });
  });

  it("shows the catalog text with retry when an export fails", async () => {
    mocks.downloadDailyMealParticipants
      .mockRejectedValueOnce(
        new ApiError("boom", 500, { code: "general.server" }),
      )
      .mockResolvedValueOnce(undefined);
    render(<MealParticipantList canRegister />);

    await openDownloadMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "PDF" }));

    expect(
      await screen.findByText(catalogText("general.server", "die Tagesliste")),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    await waitFor(() => {
      expect(mocks.downloadDailyMealParticipants).toHaveBeenCalledTimes(2);
    });
    expect(mocks.downloadDailyMealParticipants).toHaveBeenLastCalledWith(
      "2026-09-07",
      "pdf",
    );
  });

  it("retries after a temporary load error", async () => {
    mocks.getDailyMealParticipants
      .mockRejectedValueOnce(
        new ApiError("down", 503, { code: "general.unavailable" }),
      )
      .mockResolvedValueOnce({
        date: "2026-09-07",
        cutoffTime: "09:00",
        deadline: "2026-09-07T07:00:00Z",
        closed: false,
        participants: [],
        others: [],
      });

    render(<MealParticipantList canRegister />);

    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die Tagesliste"),
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    await waitFor(() => {
      expect(mocks.getDailyMealParticipants).toHaveBeenCalledTimes(2);
    });
    expect(
      (await screen.findAllByText("Keine Anmeldungen für diesen Tag")).length,
    ).toBeGreaterThan(0);
  });

  // #3873: the school changes a registration, also after the deadline.
  describe("Anmeldung ändern", () => {
    it("registers a child for the day after the deadline", async () => {
      const orders = renderWithOrderWeek();

      const dialog = await openChangeFromHead();
      fireEvent.click(within(dialog).getByRole("combobox", { name: "Kind" }));
      fireEvent.click(
        await screen.findByRole("option", {
          name: "Bauer, Ben · 3b · Isst nicht mit",
        }),
      );
      await waitFor(() =>
        expect(mocks.getChildMealSchedule).toHaveBeenCalledWith(
          "43",
          "2026-09-07",
        ),
      );
      expect(
        within(dialog).getByRole("button", { name: "Isst mit" }),
      ).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Speichern" }),
      );

      await waitFor(() =>
        expect(mocks.setChildMealDay).toHaveBeenCalledWith(
          "43",
          "2026-09-07",
          true,
        ),
      );
      await waitFor(() =>
        expect(mocks.getDailyMealParticipants).toHaveBeenCalledTimes(2),
      );
      expect(
        await screen.findByText("Die Anmeldung von Ben Bauer ist geändert."),
      ).toBeInTheDocument();
      await waitFor(() => expect(orders).toHaveBeenCalledTimes(2));
    });

    it("returns a day to the regular days", async () => {
      render(<MealParticipantList canRegister />);

      const dialog = await openChangeFromHead();
      fireEvent.click(within(dialog).getByRole("combobox", { name: "Kind" }));
      fireEvent.click(
        await screen.findByRole("option", {
          name: "Muster, Mia · 2a · Isst mit",
        }),
      );
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Wie an festen Tagen" }),
      );
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Speichern" }),
      );

      await waitFor(() =>
        expect(mocks.clearChildMealDay).toHaveBeenCalledWith(
          "42",
          "2026-09-07",
        ),
      );
      expect(mocks.setChildMealDay).not.toHaveBeenCalled();
    });

    it("blocks saving regular days that did not load and offers a retry", async () => {
      mocks.getChildMealSchedule
        .mockRejectedValueOnce(
          new ApiError("down", 503, { code: "general.unavailable" }),
        )
        .mockResolvedValueOnce({ weekdays: [2], effectiveFrom: null });
      render(<MealParticipantList canRegister />);

      const dialog = await openChangeFromHead();
      fireEvent.click(within(dialog).getByRole("combobox", { name: "Kind" }));
      fireEvent.click(
        await screen.findByRole("option", {
          name: "Muster, Mia · 2a · Isst mit",
        }),
      );
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Feste Tage" }),
      );

      expect(
        await within(dialog).findByText(
          catalogText("general.unavailable", "die festen Tage"),
        ),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByRole("button", { name: "Speichern" }),
      ).toBeDisabled();

      fireEvent.click(
        within(dialog).getByRole("button", { name: "Wiederholen" }),
      );
      await waitFor(() =>
        expect(
          within(dialog).getByRole("checkbox", { name: "Dienstag" }),
        ).toBeChecked(),
      );
      expect(
        within(dialog).getByRole("button", { name: "Speichern" }),
      ).toBeEnabled();
    });

    it("never keeps the regular days of the child chosen before", async () => {
      let answerMia: (value: { weekdays: number[] }) => void = () => undefined;
      mocks.getChildMealSchedule
        .mockReturnValueOnce(
          new Promise((resolve) => {
            answerMia = resolve;
          }),
        )
        .mockResolvedValueOnce({ weekdays: [5], effectiveFrom: null });
      render(<MealParticipantList canRegister />);

      const dialog = await openChangeFromHead();
      fireEvent.click(within(dialog).getByRole("combobox", { name: "Kind" }));
      fireEvent.click(
        await screen.findByRole("option", {
          name: "Muster, Mia · 2a · Isst mit",
        }),
      );
      fireEvent.click(within(dialog).getByRole("combobox", { name: "Kind" }));
      fireEvent.click(
        await screen.findByRole("option", {
          name: "Bauer, Ben · 3b · Isst nicht mit",
        }),
      );
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Feste Tage" }),
      );
      await waitFor(() =>
        expect(
          within(dialog).getByRole("checkbox", { name: "Freitag" }),
        ).toBeChecked(),
      );
      answerMia({ weekdays: [1, 2, 3] });
      await waitFor(() =>
        expect(
          within(dialog).getByRole("checkbox", { name: "Montag" }),
        ).not.toBeChecked(),
      );
      expect(
        within(dialog).getByRole("checkbox", { name: "Freitag" }),
      ).toBeChecked();
    });

    it("reloads the regular days for each selected effective date", async () => {
      let finishLoad: (value: {
        weekdays: number[];
        version: string;
      }) => void = () => undefined;
      render(<MealParticipantList canRegister />);
      const dialog = await openChangeFromHead();
      fireEvent.click(within(dialog).getByRole("combobox", { name: "Kind" }));
      fireEvent.click(
        await screen.findByRole("option", {
          name: "Muster, Mia · 2a · Isst mit",
        }),
      );
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Feste Tage" }),
      );
      await waitFor(() =>
        expect(
          within(dialog).getByRole("checkbox", { name: "Montag" }),
        ).toBeChecked(),
      );
      mocks.getChildMealSchedule.mockReturnValueOnce(
        new Promise((resolve) => {
          finishLoad = resolve;
        }),
      );
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Gilt ab: 07.09.2026" }),
      );
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Montag, 14. September 2026",
        }),
      );
      await waitFor(() =>
        expect(mocks.getChildMealSchedule).toHaveBeenLastCalledWith(
          "42",
          "2026-09-14",
        ),
      );
      expect(
        within(dialog).getByRole("button", { name: "Speichern" }),
      ).toBeDisabled();
      finishLoad({ weekdays: [2, 4], version: "v-later" });
      await waitFor(() =>
        expect(
          within(dialog).getByRole("checkbox", { name: "Dienstag" }),
        ).toBeChecked(),
      );
      expect(
        within(dialog).getByRole("checkbox", { name: "Donnerstag" }),
      ).toBeChecked();
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Speichern" }),
      );
      await waitFor(() =>
        expect(mocks.replaceChildMealSchedule).toHaveBeenCalledWith(
          "42",
          [2, 4],
          "2026-09-14",
          "v-later",
        ),
      );
    });

    it("sets a child's regular days from a date on", async () => {
      render(<MealParticipantList canRegister />);

      const dialog = await openChangeFromHead();
      fireEvent.click(within(dialog).getByRole("combobox", { name: "Kind" }));
      fireEvent.click(
        await screen.findByRole("option", {
          name: "Muster, Mia · 2a · Isst mit",
        }),
      );
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Feste Tage" }),
      );
      await waitFor(() =>
        expect(
          within(dialog).getByRole("checkbox", { name: "Montag" }),
        ).toBeChecked(),
      );
      fireEvent.click(
        within(dialog).getByRole("checkbox", { name: "Freitag" }),
      );
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Speichern" }),
      );

      await waitFor(() =>
        expect(mocks.replaceChildMealSchedule).toHaveBeenCalledWith(
          "42",
          [1, 3, 5],
          "2026-09-07",
          "v-read",
        ),
      );
    });

    it("offers no change on a closed day and says why", async () => {
      mocks.getDailyMealParticipants.mockResolvedValue({
        date: "2026-09-07",
        cutoffTime: "09:00",
        deadline: "2026-09-07T07:00:00Z",
        closed: true,
        participants: [],
        others: [],
      });

      render(<MealParticipantList canRegister />);

      expect(
        await screen.findByText(
          "An diesem Tag ist die OGS geschlossen. Es gibt kein Essen.",
        ),
      ).toBeInTheDocument();
      // Gesperrt mit Grund: aria-disabled statt disabled (#6643).
      expect(
        screen.getByRole("button", { name: "Anmeldung ändern" }),
      ).toHaveAttribute("aria-disabled", "true");
    });

    // Der Kopfknopf wählt kein Kind vor: das Kind wird im Fenster gewählt.
    it("opens the change from the head without a chosen child", async () => {
      render(<MealParticipantList canRegister />);

      await screen.findAllByText("Muster, Mia");
      const dialog = await openChangeFromHead();
      expect(
        within(dialog).getByRole("combobox", { name: "Kind" }),
      ).toHaveTextContent("Kind wählen");
      expect(
        within(dialog).getByRole("button", { name: "Speichern" }),
      ).toBeDisabled();
      expect(mocks.getChildMealSchedule).not.toHaveBeenCalled();
    });

    // Das Menü einer Zeile öffnet dasselbe Fenster mit diesem Kind.
    it("opens the change for one child from its row menu", async () => {
      const orders = renderWithOrderWeek();

      await screen.findAllByText("Muster, Mia");
      fireEvent.click(
        within(screen.getByRole("table")).getByRole("button", {
          name: "Aktionen für Mia Muster",
        }),
      );
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Anmeldung ändern…" }),
      );
      const dialog = await screen.findByRole("dialog");
      expect(
        within(dialog).getByRole("combobox", { name: "Kind" }),
      ).toHaveTextContent("Muster, Mia · 2a · Isst mit");
      await waitFor(() =>
        expect(mocks.getChildMealSchedule).toHaveBeenCalledWith(
          "42",
          "2026-09-07",
        ),
      );
      // Mia isst schon mit: vorgeschlagen ist die Abmeldung für den Tag.
      expect(
        within(dialog).getByRole("button", { name: "Isst nicht mit" }),
      ).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Speichern" }),
      );

      await waitFor(() =>
        expect(mocks.setChildMealDay).toHaveBeenCalledWith(
          "42",
          "2026-09-07",
          false,
        ),
      );
      expect(
        await screen.findByText("Die Anmeldung von Mia Muster ist geändert."),
      ).toBeInTheDocument();
      await waitFor(() => expect(orders).toHaveBeenCalledTimes(2));
    });

    it("offers no change for a past day", async () => {
      mocks.today = "2026-09-08";
      setTestClock(new Date("2026-09-08T12:00:00+02:00"));
      render(<MealParticipantList canRegister />);

      fireEvent.click(
        await screen.findByRole("button", { name: "Datum: 08.09.2026" }),
      );
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Montag, 7. September 2026",
        }),
      );
      await waitFor(() =>
        expect(mocks.getDailyMealParticipants).toHaveBeenCalledWith(
          "2026-09-07",
          true,
        ),
      );
      // Anker: die Zeile des vergangenen Tages ist geladen.
      expect(
        (await screen.findAllByText("Muster, Mia")).length,
      ).toBeGreaterThan(0);
      // Gesperrt mit Grund: aria-disabled statt disabled (#6643).
      expect(
        screen.getByRole("button", { name: "Anmeldung ändern" }),
      ).toHaveAttribute("aria-disabled", "true");
      expect(
        screen.queryByRole("button", { name: "Aktionen für Mia Muster" }),
      ).not.toBeInTheDocument();
    });
  });

  it("shows the week with a mark per day and exports it", async () => {
    mocks.getWeeklyMealParticipants.mockResolvedValue({
      weekStart: "2026-09-07",
      cutoffTime: "09:00",
      cutoffLeadDays: 1,
      days: [
        {
          date: "2026-09-07",
          participants: [
            {
              studentId: "42",
              firstName: "Mia",
              lastName: "Muster",
              schoolClass: "2a",
            },
            {
              studentId: "43",
              firstName: "Ben",
              lastName: "Bauer",
              schoolClass: "1b",
            },
          ],
        },
        { date: "2026-09-08", participants: [] },
        {
          date: "2026-09-09",
          participants: [
            {
              studentId: "42",
              firstName: "Mia",
              lastName: "Muster",
              schoolClass: "2a",
            },
          ],
        },
        { date: "2026-09-10", participants: [] },
        { date: "2026-09-11", participants: [] },
      ],
    });
    mocks.downloadWeeklyMealParticipants.mockResolvedValue(undefined);
    render(<MealParticipantList canRegister={false} />);
    await screen.findByText("Mittagessen am 07.09.2026");

    fireEvent.click(screen.getByRole("button", { name: "Woche" }));

    expect(
      await screen.findByText("Mittagessen vom 07.09.2026 bis 11.09.2026"),
    ).toBeInTheDocument();
    expect(mocks.getWeeklyMealParticipants).toHaveBeenCalledWith("2026-09-07");
    expect(
      screen.getByRole("heading", { name: "Wochenliste für die Küche" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Essen pro Tag:").parentElement).toHaveTextContent(
      "Essen pro Tag: Mo 2 Kinder · Di 0 Kinder · Mi 1 Kind · Do 0 Kinder · Fr 0 Kinder",
    );
    expect(screen.getAllByText("Muster, Mia").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bauer, Ben").length).toBeGreaterThan(0);
    // Mia on Mon and Wed, Ben on Mon: three marks in all.
    expect(
      within(screen.getByRole("table")).getAllByText("angemeldet"),
    ).toHaveLength(3);
    expect(
      screen.getByRole("table").querySelectorAll("svg.lucide-check"),
    ).toHaveLength(3);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Wochenliste herunterladen",
      }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Excel" }));
    await waitFor(() => {
      expect(mocks.downloadWeeklyMealParticipants).toHaveBeenCalledWith(
        "2026-09-07",
        "xlsx",
      );
    });
    expect(mocks.downloadDailyMealParticipants).not.toHaveBeenCalled();
  });

  it("marks a closed day in the week", async () => {
    const mia = {
      studentId: "42",
      firstName: "Mia",
      lastName: "Muster",
      schoolClass: "2a",
    };
    mocks.getWeeklyMealParticipants.mockResolvedValue({
      weekStart: "2026-09-07",
      days: [
        { date: "2026-09-07", closed: false, participants: [mia] },
        { date: "2026-09-08", closed: true, participants: [] },
        { date: "2026-09-09", closed: false, participants: [] },
        { date: "2026-09-10", closed: false, participants: [] },
        { date: "2026-09-11", closed: false, participants: [] },
      ],
    });
    render(<MealParticipantList canRegister={false} />);
    await screen.findByText("Mittagessen am 07.09.2026");

    fireEvent.click(screen.getByRole("button", { name: "Woche" }));

    expect(
      (await screen.findByText("Essen pro Tag:")).parentElement,
    ).toHaveTextContent(
      "Essen pro Tag: Mo 1 Kind · Di kein Essen · Mi 0 Kinder · Do 0 Kinder · Fr 0 Kinder",
    );
    expect(
      within(screen.getByRole("table")).getAllByText("kein Essen").length,
    ).toBeGreaterThan(0);
  });

  // #6503: Nur die Antwort für die aktuelle Auswahl und den jüngsten Abruf
  // darf Liste, Fehler und Ladezustand setzen.
  describe("späte Antworten", () => {
    function deferred<T>() {
      let resolve!: (value: T) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    function dayList(date: string, lastName: string) {
      return {
        date,
        cutoffTime: "09:00",
        deadline: `${date}T07:00:00Z`,
        closed: false,
        participants: [
          {
            studentId: lastName,
            firstName: "Kind",
            lastName,
            schoolClass: "1a",
          },
        ],
        others: [],
      };
    }

    async function pickDay(current: string, next: string) {
      fireEvent.click(
        screen.getByRole("button", { name: `Datum: ${current}` }),
      );
      fireEvent.click(await screen.findByRole("button", { name: next }));
    }

    /** Montag geladen, dann Dienstag und Mittwoch gewählt, beide offen. */
    async function tuesdayThenWednesday() {
      const tuesday = deferred<ReturnType<typeof dayList>>();
      const wednesday = deferred<ReturnType<typeof dayList>>();
      mocks.getDailyMealParticipants.mockImplementation((date: string) =>
        date === "2026-09-08"
          ? tuesday.promise
          : date === "2026-09-09"
            ? wednesday.promise
            : Promise.resolve(dayList(date, "Montag")),
      );
      render(<MealParticipantList canRegister={false} />);
      expect(
        (await screen.findAllByText("Montag, Kind")).length,
      ).toBeGreaterThan(0);

      await pickDay("07.09.2026", "Dienstag, 8. September 2026");
      await pickDay("08.09.2026", "Mittwoch, 9. September 2026");
      await waitFor(() =>
        expect(mocks.getDailyMealParticipants).toHaveBeenCalledWith(
          "2026-09-09",
          false,
        ),
      );
      return { tuesday, wednesday };
    }

    it("keeps Wednesday when Tuesday answers last", async () => {
      const { tuesday, wednesday } = await tuesdayThenWednesday();

      wednesday.resolve(dayList("2026-09-09", "Mittwoch"));
      expect(
        (await screen.findAllByText("Mittwoch, Kind")).length,
      ).toBeGreaterThan(0);
      tuesday.resolve(dayList("2026-09-08", "Dienstag"));
      await tuesday.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Anker: Mittwoch steht weiter unter dem Mittwochsdatum.
      expect(screen.getByText("Mittagessen am 09.09.2026")).toBeInTheDocument();
      expect(screen.getAllByText("Mittwoch, Kind").length).toBeGreaterThan(0);
      expect(screen.queryByText("Dienstag, Kind")).not.toBeInTheDocument();
    });

    it("shows no Tuesday children under Wednesday when Tuesday answers first", async () => {
      const { tuesday, wednesday } = await tuesdayThenWednesday();

      tuesday.resolve(dayList("2026-09-08", "Dienstag"));
      await tuesday.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Anker: das Mittwochsdatum ist gewählt, seine Liste lädt noch.
      expect(screen.getByText("Mittagessen am 09.09.2026")).toBeInTheDocument();
      expect(screen.getByText("Wird geladen…")).toBeInTheDocument();
      expect(screen.queryByText("Dienstag, Kind")).not.toBeInTheDocument();

      wednesday.resolve(dayList("2026-09-09", "Mittwoch"));
      expect(
        (await screen.findAllByText("Mittwoch, Kind")).length,
      ).toBeGreaterThan(0);
      expect(screen.queryByText("Dienstag, Kind")).not.toBeInTheDocument();
    });

    it("ignores a failure of an older request after the newer one succeeded", async () => {
      const { tuesday, wednesday } = await tuesdayThenWednesday();

      wednesday.resolve(dayList("2026-09-09", "Mittwoch"));
      expect(
        (await screen.findAllByText("Mittwoch, Kind")).length,
      ).toBeGreaterThan(0);
      tuesday.reject(
        new ApiError("down", 503, { code: "general.unavailable" }),
      );
      await tuesday.promise.catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Anker: die Mittwochsliste steht weiter da.
      expect(screen.getAllByText("Mittwoch, Kind").length).toBeGreaterThan(0);
      expect(
        screen.queryByText(
          catalogText("general.unavailable", "die Tagesliste"),
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Wiederholen" }),
      ).not.toBeInTheDocument();
    });

    it("ignores a late week answer after switching back to the day", async () => {
      const week = deferred<unknown>();
      mocks.getWeeklyMealParticipants.mockReturnValue(week.promise);
      render(<MealParticipantList canRegister={false} />);
      expect(
        (await screen.findAllByText("Muster, Mia")).length,
      ).toBeGreaterThan(0);

      fireEvent.click(screen.getByRole("button", { name: "Woche" }));
      await waitFor(() =>
        expect(mocks.getWeeklyMealParticipants).toHaveBeenCalledWith(
          "2026-09-07",
        ),
      );
      fireEvent.click(screen.getByRole("button", { name: "Tag" }));
      await waitFor(() =>
        expect(mocks.getDailyMealParticipants).toHaveBeenCalledTimes(2),
      );
      expect(
        (await screen.findAllByText("Muster, Mia")).length,
      ).toBeGreaterThan(0);

      week.reject(new ApiError("down", 503, { code: "general.unavailable" }));
      await week.promise.catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Anker: die Tagesliste steht weiter da.
      expect(screen.getByText("Mittagessen am 07.09.2026")).toBeInTheDocument();
      expect(screen.getAllByText("Muster, Mia").length).toBeGreaterThan(0);
      expect(
        screen.queryByText(
          catalogText("general.unavailable", "die Wochenliste"),
        ),
      ).not.toBeInTheDocument();
    });

    it("keeps the loaded list of the same day when a reload fails", async () => {
      render(<MealParticipantList canRegister />);

      const dialog = await openChangeFromHead();
      fireEvent.click(within(dialog).getByRole("combobox", { name: "Kind" }));
      fireEvent.click(
        await screen.findByRole("option", {
          name: "Muster, Mia · 2a · Isst mit",
        }),
      );
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Wie an festen Tagen" }),
      );
      mocks.getDailyMealParticipants.mockRejectedValueOnce(
        new ApiError("down", 503, { code: "general.unavailable" }),
      );
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Speichern" }),
      );

      expect(
        await screen.findByText(
          catalogText("general.unavailable", "die Tagesliste"),
        ),
      ).toBeInTheDocument();
      // Die bestätigte Liste des Tages bleibt unter dem Fehler stehen.
      expect(screen.getByRole("table")).toBeInTheDocument();
      expect(
        within(screen.getByRole("table")).getAllByText("Muster, Mia").length,
      ).toBeGreaterThan(0);
    });
  });
});
