import "@testing-library/jest-dom/vitest";
import {
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { ToastProvider } from "~/contexts/ToastContext";
import { SWRConfig } from "~/lib/swr/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchAnnouncements,
  createAnnouncement,
  publishAnnouncement,
  updateAnnouncement,
  uploadAnnouncementAttachment,
  type Announcement,
} from "~/lib/parent-announcements-api";
import { SAVED_BUT_STALE_SUFFIX } from "~/lib/hooks/use-refresh-after-write";
import { ApiError, unavailableApiError } from "~/lib/api-error";
import { TEST_CLOCK_INSTANT } from "~/test/clock";
import { catalogText } from "~/test/error-catalog-text";
import ParentAnnouncementsPage from "./page";

vi.unmock("swr");

// The draft's attachments read through real SWR under a staff session; the
// other resources stay per-key fakes.
function Providers({ children }: { readonly children: ReactNode }) {
  return (
    <SessionProvider
      session={{
        user: { id: "staff-7", scope: "tenant", tenantId: 42 },
        expires: "2099-01-01",
      }}
    >
      <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
        <ToastProvider>{children}</ToastProvider>
      </SWRConfig>
    </SessionProvider>
  );
}

function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: Providers });
}
import { stashAnnouncementStudents } from "~/lib/announcement-prefill";

const { searchParams, pushMock, updateUrlParamsMock, listState, previewLoad } =
  vi.hoisted(() => ({
    searchParams: new URLSearchParams(),
    pushMock: vi.fn(),
    updateUrlParamsMock: vi.fn(),
    listState: {
      data: undefined as Announcement[] | undefined,
      isLoading: false,
      error: null as Error | null,
      // A failed read again of the list (`revalidateOrThrow`).
      reloadError: null as Error | null,
    },
    previewLoad: { error: null as Error | null, retry: vi.fn() },
  }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
  usePathname: () => "/parent-announcements",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("~/hooks/useUpdateUrlParams", () => ({
  useUpdateUrlParams: () => updateUrlParamsMock,
}));

vi.mock("~/lib/tenant-router", () => ({
  useTenantRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("~/lib/tenant-context", () => ({
  useTenantSafe: () => null,
  useTenantSlugSafe: () => "testschule",
  useTenantRoutingModeSafe: () => "subdomain",
}));

vi.mock("~/lib/swr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/swr")>();
  return {
    ...actual,
    useSWRAuth: ((
      key: string | null,
      fetcher: () => Promise<unknown>,
      options?: object,
    ) =>
      key?.startsWith("announcement-attachments-")
        ? actual.useSWRAuth(key, fetcher, options)
        : key === "parent-announcements-list"
          ? {
              ...listState,
              mutate: vi.fn(
                async (data?: Promise<Announcement[]>) =>
                  data ?? fetchAnnouncements(true).catch(() => listState.data),
              ),
              readCurrent: () =>
                listState.reloadError
                  ? { data: listState.data, error: listState.reloadError }
                  : undefined,
            }
          : key === "parent-letter-preview-children-school"
            ? {
                data: undefined,
                isLoading: false,
                error: previewLoad.error,
                mutate: previewLoad.retry,
              }
            : {
                data: undefined,
                isLoading: false,
                error: null,
                mutate: vi.fn(),
              }) as typeof actual.useSWRAuth,
  };
});

vi.mock("~/lib/parent-announcements-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/lib/parent-announcements-api")>();
  return {
    ...actual,
    fetchAnnouncements: vi.fn(() => Promise.resolve([])),
    createAnnouncement: vi.fn(() => Promise.resolve({ id: "new" })),
    updateAnnouncement: vi.fn(() => Promise.resolve({ id: "1" })),
    publishAnnouncement: vi.fn(() => Promise.resolve({ id: "1" })),
    uploadAnnouncementAttachment: vi.fn(),
    fetchAnnouncementAttachments: vi.fn(() =>
      Promise.resolve({
        attachments: [],
        max_count: 5,
        max_bytes: 1,
        editable: true,
      }),
    ),
  };
});

vi.mock("~/lib/api", () => ({
  groupService: { getGroups: vi.fn(() => Promise.resolve([])) },
}));

vi.mock("~/lib/student-api", () => ({
  fetchSchoolClasses: vi.fn(() => Promise.resolve([])),
}));

vi.mock("~/lib/activity-api", () => ({
  fetchActivities: vi.fn(() => Promise.resolve([])),
}));

const base: Announcement = {
  id: "1",
  version: "2026-09-01T08:00:00Z",
  title: "Sommerfest",
  body: "Am Freitag.",
  priority: "info",
  requires_acknowledgement: false,
  send_email: false,
  status: "draft",
  active: true,
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
  targets: [{ target_type: "school_all" }],
  response_type: "none",
  options: [],
  delivery_mode: "standard",
  email_audience: "portal_only",
};

const poll: Announcement = {
  ...base,
  id: "2",
  title: "Kommt Ihr Kind?",
  status: "published",
  published_at: "2026-09-02T10:00:00Z",
  response_type: "single_choice",
  options: [
    { id: "a", label: "Ja" },
    { id: "b", label: "Nein" },
  ],
};

const letter: Announcement = {
  ...base,
  id: "3",
  title: "Elternbrief zum Sommerfest",
  status: "published",
  delivery_mode: "letter",
};

const draftPoll: Announcement = {
  ...poll,
  id: "4",
  title: "Kommt Ihr Kind am Montag?",
  status: "draft",
  published_at: undefined,
};

describe("ParentAnnouncementsPage (#3115)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams.delete("art");
    searchParams.delete("bearbeiten");
    searchParams.delete("search");
    searchParams.delete("status");
    listState.data = [base, poll];
    listState.isLoading = false;
    listState.error = null;
    previewLoad.error = null;
  });

  it("opens the object page from the row and from „Anzeigen“", async () => {
    render(<ParentAnnouncementsPage />);

    fireEvent.change(screen.getAllByPlaceholderText("Titel suchen…")[0]!, {
      target: { value: "Sommer" },
    });

    // Die Tabelle rendert jede Zeile für Desktop und Telefon; die erste
    // Ausprägung reicht für den Klick.
    fireEvent.click((await screen.findAllByText("Sommerfest"))[0]!);
    expect(pushMock).toHaveBeenCalledWith(
      `/parent-announcements/1?from=${encodeURIComponent("/parent-announcements?art=mitteilungen&search=Sommer")}`,
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: "Aktionen für Sommerfest" })[0]!,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Anzeigen" }));
    expect(pushMock).toHaveBeenCalledTimes(2);
  });

  // #5034: Anlegen steht nur im Kopf. Eine gefilterte leere Liste bietet
  // das Zurücksetzen an, nicht ein zweites Anlegen.
  it("offers Filter zurücksetzen instead of a second create button when the search finds nothing", async () => {
    render(<ParentAnnouncementsPage />);

    fireEvent.change(screen.getAllByPlaceholderText("Titel suchen…")[0]!, {
      target: { value: "Gibt es nicht" },
    });

    expect(
      await screen.findByText("Keine passenden Einträge"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", {
        name: "Neue Elternmitteilung erstellen",
      }),
    ).toHaveLength(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Filter zurücksetzen" }),
    );
    expect((await screen.findAllByText("Sommerfest")).length).toBeGreaterThan(
      0,
    );
  });

  it("shows the empty state without a second create button", async () => {
    listState.data = [];
    render(<ParentAnnouncementsPage />);

    expect(await screen.findByText("Keine Mitteilungen")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", {
        name: "Neue Elternmitteilung erstellen",
      }),
    ).toHaveLength(1);
  });

  it("reads the tab from the address and writes it back on change", async () => {
    searchParams.set("art", "umfragen");
    render(<ParentAnnouncementsPage />);

    expect(
      (await screen.findAllByText("Kommt Ihr Kind?")).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Sommerfest")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Mitteilungen/ }));
    expect(updateUrlParamsMock).toHaveBeenCalledWith({ art: null });

    fireEvent.click((await screen.findAllByText("Kommt Ihr Kind?"))[0]!);
    expect(pushMock).toHaveBeenCalledWith(
      `/parent-announcements/2?from=${encodeURIComponent("/parent-announcements?art=umfragen")}`,
    );
  });

  it("labels the summary on the Elternbriefe tab correctly", async () => {
    searchParams.set("art", "elternbriefe");
    listState.data = [letter];
    render(<ParentAnnouncementsPage />);

    // Statuszeile: Wert-Label-Paare ohne Trennpunkt (#7402).
    expect(
      (await screen.findByText("veröffentlicht")).parentElement?.parentElement,
    ).toHaveTextContent(/^1 Elternbrief, 1 veröffentlicht$/);
  });

  it("shows and retries a failed preview child load instead of an empty-school message", async () => {
    searchParams.set("art", "elternbriefe");
    previewLoad.error = unavailableApiError(new TypeError("Failed to fetch"));
    render(<ParentAnnouncementsPage />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Neuen Elternbrief erstellen",
      }),
    );
    fireEvent.change(screen.getByLabelText(/^Text/), {
      target: { value: "Hallo {{vorname}}" },
    });
    const retry = await screen.findByRole("button", { name: /Wiederholen/ });
    expect(screen.getByRole("alert")).toHaveTextContent(/Kinder.*Vorschau/);
    expect(
      screen.queryByText(/Noch kein Kind in der Auswahl/),
    ).not.toBeInTheDocument();
    fireEvent.click(retry);
    expect(previewLoad.retry).toHaveBeenCalledOnce();
  });

  it("opens the wizard for a draft requested via ?bearbeiten= and clears the parameter", async () => {
    searchParams.set("bearbeiten", "1");
    render(<ParentAnnouncementsPage />);

    expect(
      await screen.findByText("Elternmitteilung bearbeiten"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(updateUrlParamsMock).toHaveBeenCalledWith({ bearbeiten: null }),
    );
  });

  it("ignores ?bearbeiten= for a published announcement", async () => {
    searchParams.set("art", "umfragen");
    searchParams.set("bearbeiten", "2");
    render(<ParentAnnouncementsPage />);

    // Anker: die Umfragen-Liste mit der angefragten Umfrage ist geladen.
    expect(
      (await screen.findAllByText("Kommt Ihr Kind?")).length,
    ).toBeGreaterThan(0);

    await waitFor(() =>
      expect(updateUrlParamsMock).toHaveBeenCalledWith({ bearbeiten: null }),
    );
    expect(screen.queryByText("Umfrage bearbeiten")).not.toBeInTheDocument();
  });

  it("opens the poll wizard via ?bearbeiten= while the poll is a draft", async () => {
    listState.data = [
      base,
      { ...poll, status: "draft", published_at: undefined },
    ];
    searchParams.set("art", "umfragen");
    searchParams.set("bearbeiten", "2");
    render(<ParentAnnouncementsPage />);

    expect(await screen.findByText("Umfrage bearbeiten")).toBeInTheDocument();
  });
});

describe("ParentAnnouncementsPage: scheduled reminder (#3162)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams.delete("art");
    searchParams.delete("bearbeiten");
    listState.isLoading = false;
    listState.error = null;
  });

  it("shows the reminder state in the list", async () => {
    const day = 24 * 60 * 60 * 1000;
    // Veröffentlicht vor einer Woche, Erinnerung in 15 Tagen.
    const reminder = new Date(TEST_CLOCK_INSTANT.getTime() + 15 * day);
    listState.data = [
      {
        ...base,
        status: "published",
        published_at: new Date(
          TEST_CLOCK_INSTANT.getTime() - 7 * day,
        ).toISOString(),
        reminder_at: reminder.toISOString(),
      },
    ];
    render(<ParentAnnouncementsPage />);

    const when = new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(reminder);
    expect(
      (await screen.findAllByText(`Erinnerung am ${when} Uhr`)).length,
    ).toBeGreaterThan(0);
  });

  it("offers the reminder in the Mitteilung wizard but not in the Umfrage wizard", async () => {
    listState.data = [
      { ...base, reminder_at: "2026-09-24T06:00:00Z" },
      draftPoll,
    ];
    searchParams.set("bearbeiten", "1");
    const { unmount } = render(<ParentAnnouncementsPage />);

    expect(
      await screen.findByText("Elternmitteilung bearbeiten"),
    ).toBeInTheDocument();
    expect(screen.getByText("Erinnern am (optional)")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Die E-Mail hat nur Titel und Link. Den Text sehen Eltern im Eltern-Portal.",
      ),
    ).toBeInTheDocument();
    unmount();

    searchParams.set("art", "umfragen");
    searchParams.set("bearbeiten", "4");
    render(<ParentAnnouncementsPage />);

    expect(await screen.findByText("Umfrage bearbeiten")).toBeInTheDocument();
    expect(
      screen.queryByText("Erinnern am (optional)"),
    ).not.toBeInTheDocument();
  });

  // Terminabstimmung (#3861): a list copied from a spreadsheet becomes one
  // answer per line instead of one long label.
  it("splits a pasted list into one answer per line", async () => {
    listState.data = [draftPoll];
    searchParams.set("art", "umfragen");
    searchParams.set("bearbeiten", "4");
    render(<ParentAnnouncementsPage />);

    const second = await screen.findByRole("textbox", { name: "Antwort 2" });
    fireEvent.paste(second, {
      clipboardData: {
        getData: () => "Di 14.10.\t15:00\nDi 14.10.\t15:15\n\n",
      },
    });

    expect(screen.getByRole("textbox", { name: "Antwort 2" })).toHaveValue(
      "Nein",
    );
    expect(screen.getByRole("textbox", { name: "Antwort 3" })).toHaveValue(
      "Di 14.10. 15:00",
    );
    expect(screen.getByRole("textbox", { name: "Antwort 4" })).toHaveValue(
      "Di 14.10. 15:15",
    );
    expect(
      screen.queryByRole("textbox", { name: "Antwort 5" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Zwei bis 60 Antworten\./)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Als Entwurf speichern" }),
    );
    await waitFor(() =>
      expect(updateAnnouncement).toHaveBeenCalledWith(
        "4",
        expect.objectContaining({
          options: ["Ja", "Nein", "Di 14.10. 15:00", "Di 14.10. 15:15"],
        }),
        "2026-09-01T08:00:00Z",
      ),
    );
  });

  it("replaces untouched default answers with a full appointment list", async () => {
    listState.data = [];
    searchParams.set("art", "umfragen");
    render(<ParentAnnouncementsPage />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Neue Umfrage erstellen",
      }),
    );

    const lines = Array.from({ length: 60 }, (_, i) => `Termin ${i + 1}`);
    fireEvent.paste(await screen.findByRole("textbox", { name: "Antwort 1" }), {
      clipboardData: { getData: () => lines.join("\n") },
    });

    expect(screen.getByRole("textbox", { name: "Antwort 1" })).toHaveValue(
      "Termin 1",
    );
    expect(screen.getByRole("textbox", { name: "Antwort 60" })).toHaveValue(
      "Termin 60",
    );
    expect(
      screen.queryByRole("textbox", { name: "Antwort 61" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Es passen höchstens 60 Antworten/),
    ).not.toBeInTheDocument();
  });

  it("says how many pasted lines did not fit", async () => {
    listState.data = [draftPoll];
    searchParams.set("art", "umfragen");
    searchParams.set("bearbeiten", "4");
    render(<ParentAnnouncementsPage />);

    const second = await screen.findByRole("textbox", { name: "Antwort 2" });
    const lines = Array.from({ length: 61 }, (_, i) => `Termin ${i + 1}`);
    fireEvent.paste(second, {
      clipboardData: { getData: () => lines.join("\n") },
    });

    expect(
      await screen.findByText(
        "Es passen höchstens 60 Antworten. 3 Zeilen wurden nicht übernommen.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Antwort 60" })).toHaveValue(
      "Termin 58",
    );
    expect(
      screen.getByRole("button", { name: "Antwort hinzufügen" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("rejects pasted answers longer than 120 characters", async () => {
    listState.data = [draftPoll];
    searchParams.set("art", "umfragen");
    searchParams.set("bearbeiten", "4");
    render(<ParentAnnouncementsPage />);

    const second = await screen.findByRole("textbox", { name: "Antwort 2" });
    fireEvent.paste(second, {
      clipboardData: { getData: () => `${"A".repeat(121)}\nVielleicht` },
    });

    expect(
      await screen.findByText(
        "Eine Zeile ist länger als 120 Zeichen. Sie wurde nicht übernommen.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Antwort 3" })).toHaveValue(
      "Vielleicht",
    );
  });

  it("shows the reload failure after creating the first announcement", async () => {
    listState.data = [];
    const token = stashAnnouncementStudents("testschule", [
      { id: "7", name: "Mia Arslan" },
    ]);
    searchParams.set("neu", "kinder");
    searchParams.set("vorbelegung", token!);
    render(<ParentAnnouncementsPage />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Titel" }), {
      target: { value: "Erste Mitteilung" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Text" }), {
      target: { value: "Bitte lesen." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    vi.mocked(fetchAnnouncements).mockRejectedValueOnce(
      new ApiError("down", 503),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Als Entwurf speichern" }),
    );
    expect(
      await screen.findByText(
        `${catalogText("general.unavailable", "die Anzeige der Mitteilungen")} ${SAVED_BUT_STALE_SUFFIX}`,
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Wiederholen" })).toBeVisible();
    expect(createAnnouncement).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    await waitFor(() => expect(fetchAnnouncements).toHaveBeenCalledTimes(2));
    expect(createAnnouncement).toHaveBeenCalledTimes(1);
  });

  it("reports a failed list read after saving a draft", async () => {
    listState.data = [base];
    searchParams.set("bearbeiten", "1");
    render(<ParentAnnouncementsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Weiter" }));
    vi.mocked(fetchAnnouncements).mockRejectedValueOnce(
      new ApiError("down", 503),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Als Entwurf speichern" }),
    );
    // Anker: der Listenfehler sagt, dass der Entwurf bereits gespeichert ist.
    expect(
      await screen.findByText(
        `${catalogText("general.unavailable", "die Anzeige der Mitteilungen")} ${SAVED_BUT_STALE_SUFFIX}`,
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    await waitFor(() => expect(fetchAnnouncements).toHaveBeenCalledTimes(2));
    expect(updateAnnouncement).toHaveBeenCalledTimes(1);
  });

  it("saves a draft with an elapsed reminder", async () => {
    listState.data = [
      {
        ...base,
        reminder_at: "2026-09-08T06:00:00Z",
      },
    ];
    searchParams.set("bearbeiten", "1");
    render(<ParentAnnouncementsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Weiter" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Als Entwurf speichern" }),
    );

    await waitFor(() => expect(updateAnnouncement).toHaveBeenCalledTimes(1));
  });

  it("shows a validation error for an incomplete reminder time in a draft", async () => {
    listState.data = [
      {
        ...base,
        reminder_at: "2026-09-24T06:00:00Z",
      },
    ];
    searchParams.set("bearbeiten", "1");
    render(<ParentAnnouncementsPage />);

    fireEvent.change(await screen.findByRole("textbox", { name: /Uhrzeit/ }), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Uhrzeit");
    expect(updateAnnouncement).not.toHaveBeenCalled();
  });

  // #2517: Fehler über den gemeinsamen Anzeigeweg.
  it("marks a missing title at the field before going on", async () => {
    listState.data = [{ ...base, title: "" }];
    searchParams.set("bearbeiten", "1");
    render(<ParentAnnouncementsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Weiter" }));

    expect(
      await screen.findByText("Bitte gib einen Titel ein."),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Titel" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("keeps a failed save in the form with the catalog text and retries", async () => {
    vi.mocked(updateAnnouncement)
      .mockRejectedValueOnce(
        new ApiError("db exploded", 500, { code: "general.server" }),
      )
      .mockResolvedValueOnce({ ...base });
    listState.data = [base];
    searchParams.set("bearbeiten", "1");
    render(<ParentAnnouncementsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Weiter" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Als Entwurf speichern" }),
    );

    expect(
      await screen.findByText(
        catalogText("general.server", "das Speichern der Mitteilung"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/db exploded/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    await waitFor(() => expect(updateAnnouncement).toHaveBeenCalledTimes(2));
  });

  it("shows a failed list load with the catalog text, not an empty list", async () => {
    listState.data = undefined;
    listState.error = new ApiError("down", 503, {
      code: "general.unavailable",
    });
    render(<ParentAnnouncementsPage />);

    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die Liste der Mitteilungen"),
      ),
    ).toBeInTheDocument();
    // #2517: keine Zählung aus einer Liste, die nie geladen wurde.
    expect(screen.queryByText(/0 Mitteilungen/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 veröffentlicht/)).not.toBeInTheDocument();
    // Die Statuszeile setzt Zahl und Wort in eigene Elemente (#7402).
    expect(screen.queryByText("veröffentlicht")).not.toBeInTheDocument();
  });
});

describe("ParentAnnouncementsPage: children handed over by another page (#3379)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams.delete("art");
    searchParams.delete("bearbeiten");
    searchParams.delete("neu");
    searchParams.delete("vorbelegung");
    window.sessionStorage.clear();
    listState.data = [base];
    listState.isLoading = false;
    listState.error = null;
  });

  it("opens a new announcement addressed to the handed-over children", async () => {
    const token = stashAnnouncementStudents("testschule", [
      { id: "7", name: "Mia Arslan" },
      { id: "8", name: "Ben Yilmaz" },
    ]);
    expect(token).not.toBeNull();
    searchParams.set("neu", "kinder");
    searchParams.set("vorbelegung", token!);
    render(<ParentAnnouncementsPage />);

    expect(
      await screen.findByText("Neue Elternmitteilung"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(updateUrlParamsMock).toHaveBeenCalledWith({
        neu: null,
        vorbelegung: null,
      }),
    );
    // Read once: a reload must not address the same families again.
    expect(
      window.sessionStorage.getItem(`moto:announcement-prefill:${token}`),
    ).toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: "Titel" }), {
      target: { value: "Anmeldung fehlt noch" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Text" }), {
      target: { value: "Bitte melden Sie Ihr Kind an." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));

    expect(await screen.findByText("Mia Arslan")).toBeInTheDocument();
    expect(screen.getByText("Ben Yilmaz")).toBeInTheDocument();
  });

  it("stays on the list when nothing was handed over", async () => {
    searchParams.set("neu", "kinder");
    searchParams.set("vorbelegung", "missing");
    render(<ParentAnnouncementsPage />);

    // Anker: die Liste der Mitteilungen ist geladen.
    expect((await screen.findAllByText("Sommerfest")).length).toBeGreaterThan(
      0,
    );

    await waitFor(() =>
      expect(updateUrlParamsMock).toHaveBeenCalledWith({
        neu: null,
        vorbelegung: null,
      }),
    );
    // Die Liste bleibt stehen, der Assistent öffnet sich nicht.
    expect(screen.getAllByText("Sommerfest").length).toBeGreaterThan(0);
    expect(screen.queryByText("Neue Elternmitteilung")).not.toBeInTheDocument();
  });
});

describe("ParentAnnouncementsPage: Einverständnisse (#3430)", () => {
  const declarationDraft: Announcement = {
    ...base,
    id: "9",
    title: "Ausflug in den Zoo",
    delivery_mode: "declaration",
    declaration_kind: "consent",
    declaration_signers: "any",
    declaration_requires_password: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    searchParams.delete("art");
    searchParams.delete("bearbeiten");
    searchParams.delete("search");
    searchParams.delete("status");
    listState.isLoading = false;
    listState.error = null;
  });

  it("lists Einverständnisse on their own tab", async () => {
    searchParams.set("art", "erklaerungen");
    listState.data = [base, declarationDraft];
    render(<ParentAnnouncementsPage />);

    expect(
      (await screen.findAllByText("Ausflug in den Zoo")).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Sommerfest")).not.toBeInTheDocument();
    expect(
      screen.getByText("veröffentlicht").parentElement?.parentElement,
    ).toHaveTextContent(/^1 Einverständnis, 0 veröffentlicht$/);
    expect(
      screen.getByRole("tab", { name: /Einverständnisse/ }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Neues Einverständnis erstellen" }),
    ).toHaveLength(1);
  });

  it("sends the Einverständnis settings and offers no Kenntnisnahme, poll or read confirmation", async () => {
    searchParams.set("art", "erklaerungen");
    searchParams.set("bearbeiten", "9");
    listState.data = [declarationDraft];
    render(<ParentAnnouncementsPage />);

    expect(
      await screen.findByText("Einverständnis bearbeiten"),
    ).toBeInTheDocument();
    // Neither a poll nor a read confirmation belongs to an Einverständnis.
    expect(
      screen.queryByText("Lesebestätigung erforderlich"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Antwortmöglichkeiten")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Verlangt ein Gesetz eine Erklärung auf Papier/),
    ).toBeInTheDocument();

    expect(
      screen.getByText(/Dann schreibe einen Elternbrief mit/),
    ).toBeInTheDocument();
    // Only one kind is left: no choice, no Kenntnisnahme anywhere.
    expect(screen.queryByText(/Kenntnis/)).not.toBeInTheDocument();
    expect(
      screen.queryByText("Was sollen die Eltern tun?"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("radio", { name: /Alle sorgeberechtigten Personen/ }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Passwort vor dem Antworten abfragen/,
      }),
    );
    expect(screen.getByText("Frist (optional)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    // Pending enrollments are no audience for an Einverständnis.
    expect((await screen.findAllByText("Ganze Schule")).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("Wer soll gefragt werden?")).toBeInTheDocument();
    expect(screen.queryByText("Offene Anmeldungen")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Als Entwurf speichern" }),
    );

    await waitFor(() => expect(updateAnnouncement).toHaveBeenCalledTimes(1));
    expect(updateAnnouncement).toHaveBeenCalledWith(
      "9",
      expect.objectContaining({
        delivery_mode: "declaration",
        response_type: "none",
        requires_acknowledgement: false,
        email_audience: "portal_only",
        response_deadline: null,
        declaration_kind: "consent",
        declaration_signers: "all",
        declaration_requires_password: true,
      }),
      "2026-09-01T08:00:00Z",
    );
  });

  it("offers no switch against revoking: a consent is always revocable (#6303)", async () => {
    searchParams.set("art", "erklaerungen");
    searchParams.set("bearbeiten", "9");
    listState.data = [declarationDraft];
    render(<ParentAnnouncementsPage />);

    expect(
      await screen.findByRole("checkbox", { name: /Mit Unterschrift/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: /Widerruf/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Danach können Eltern nicht mehr antworten. Eine Zustimmung widerrufen geht weiter.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Als Entwurf speichern" }),
    );

    await waitFor(() =>
      expect(updateAnnouncement).toHaveBeenCalledWith(
        "9",
        expect.objectContaining({
          declaration_kind: "consent",
          declaration_signers: "any",
          declaration_requires_password: false,
          declaration_requires_signature: false,
        }),
        "2026-09-01T08:00:00Z",
      ),
    );
    expect(vi.mocked(updateAnnouncement).mock.calls[0]?.[1]).not.toHaveProperty(
      "declaration_revocable",
    );
  });

  it("asks for a signature when the school ticks it (#4785)", async () => {
    searchParams.set("art", "erklaerungen");
    searchParams.set("bearbeiten", "9");
    listState.data = [declarationDraft];
    render(<ParentAnnouncementsPage />);

    const signature = await screen.findByRole("checkbox", {
      name: /Mit Unterschrift/,
    });
    expect(signature).not.toBeChecked();
    expect(
      screen.getByText(
        /Eltern unterschreiben die Zustimmung mit dem Finger oder der Maus\./,
      ),
    ).toBeInTheDocument();
    fireEvent.click(signature);
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Als Entwurf speichern" }),
    );

    await waitFor(() =>
      expect(updateAnnouncement).toHaveBeenCalledWith(
        "9",
        expect.objectContaining({ declaration_requires_signature: true }),
        "2026-09-01T08:00:00Z",
      ),
    );
  });

  it("shows the files read-only once a version exists", async () => {
    searchParams.set("art", "erklaerungen");
    searchParams.set("bearbeiten", "9");
    listState.data = [
      { ...declarationDraft, declaration_locked_attachments: true },
    ];
    render(<ParentAnnouncementsPage />);

    expect(
      await screen.findByText(
        "Dieses Einverständnis war schon veröffentlicht. Die Dateien bleiben deshalb gleich. Für andere Dateien lege ein neues Einverständnis an.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Datei auswählen" }),
    ).not.toBeInTheDocument();
  });
});

// The editor is the draft of the stored announcement (ADR 0311): a refusal
// shows the stored state instead of the input, a newer read refills an
// untouched form, and a save never sends old input on a newer version.
describe("ParentAnnouncementsPage: der gelesene Stand (ADR 0311)", () => {
  const changedSinceRead = () =>
    new ApiError("changed", 409, { code: "general.changed_since_read" });
  const byColleague: Announcement = {
    ...base,
    version: "2026-09-02T08:00:00Z",
    title: "Sommerfest am Samstag",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    searchParams.delete("art");
    searchParams.delete("search");
    searchParams.delete("status");
    searchParams.set("bearbeiten", "1");
    listState.data = [base];
    listState.isLoading = false;
    listState.error = null;
    listState.reloadError = null;
    previewLoad.error = null;
  });

  const titleField = () => screen.findByRole("textbox", { name: "Titel" });
  const saveDraft = async () =>
    fireEvent.click(
      await screen.findByRole("button", { name: "Als Entwurf speichern" }),
    );

  it("never sends the refused input on the version read after a failed reload", async () => {
    render(<ParentAnnouncementsPage />);
    fireEvent.change(await titleField(), { target: { value: "Mein Titel" } });
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    vi.mocked(updateAnnouncement).mockRejectedValueOnce(changedSinceRead());
    listState.reloadError = new ApiError("down", 503);
    await saveDraft();
    await waitFor(() => expect(updateAnnouncement).toHaveBeenCalledTimes(1));
    const retry = await screen.findByRole("button", { name: "Wiederholen" });

    // While the stored draft is not there, a save sends nothing.
    await saveDraft();
    expect(updateAnnouncement).toHaveBeenCalledTimes(1);

    // The read succeeds: the form shows the colleague's draft, not the
    // refused input.
    listState.reloadError = null;
    listState.data = [byColleague];
    vi.mocked(fetchAnnouncements).mockResolvedValue([byColleague]);
    fireEvent.click(retry);
    fireEvent.click(await screen.findByRole("button", { name: "Zurück" }));
    await waitFor(async () =>
      expect(await titleField()).toHaveValue("Sommerfest am Samstag"),
    );

    vi.mocked(updateAnnouncement).mockResolvedValueOnce(byColleague);
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    await saveDraft();
    await waitFor(() => expect(updateAnnouncement).toHaveBeenCalledTimes(2));
    const [, input, version] = vi.mocked(updateAnnouncement).mock.calls[1]!;
    expect(version).toBe(byColleague.version);
    expect(input.title).toBe("Sommerfest am Samstag");
  });

  it("refills an untouched form with a newer read", async () => {
    const { rerender } = render(<ParentAnnouncementsPage />);
    expect(await titleField()).toHaveValue("Sommerfest");

    listState.data = [byColleague];
    rerender(<ParentAnnouncementsPage />);

    await waitFor(async () =>
      expect(await titleField()).toHaveValue("Sommerfest am Samstag"),
    );
  });

  it("closes the form and says so when the refused draft was deleted", async () => {
    render(<ParentAnnouncementsPage />);
    fireEvent.change(await titleField(), { target: { value: "Mein Titel" } });
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    vi.mocked(updateAnnouncement).mockRejectedValueOnce(changedSinceRead());
    vi.mocked(fetchAnnouncements).mockResolvedValue([]);
    listState.data = [];
    await saveDraft();

    expect(
      await screen.findByText(
        "Diese Mitteilung gibt es nicht mehr. Deine Änderungen sind nicht gespeichert.",
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByText("Elternmitteilung bearbeiten"),
      ).not.toBeInTheDocument(),
    );
    expect(updateAnnouncement).toHaveBeenCalledTimes(1);
  });

  it("publishes the version the last upload answered", async () => {
    const saved: Announcement = { ...base, version: "2026-09-03T08:00:00Z" };
    vi.mocked(updateAnnouncement).mockResolvedValueOnce(saved);
    vi.mocked(uploadAnnouncementAttachment).mockResolvedValueOnce({
      id: "att-1",
      filename: "Plan.pdf",
      size_bytes: 10,
      content_type: "application/pdf",
      uploaded_at: "2026-09-03T08:00:01Z",
      announcement_version: "2026-09-03T08:00:01Z",
    });
    const { container } = render(<ParentAnnouncementsPage />);
    await titleField();
    const input =
      container.ownerDocument.querySelector<HTMLInputElement>(
        'input[type="file"]',
      );
    expect(input).not.toBeNull();
    fireEvent.change(input!, {
      target: {
        files: [new File(["%PDF"], "Plan.pdf", { type: "application/pdf" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Veröffentlichen" }),
    );

    await waitFor(() => expect(publishAnnouncement).toHaveBeenCalledTimes(1));
    expect(vi.mocked(uploadAnnouncementAttachment).mock.calls[0]![2]).toBe(
      saved.version,
    );
    expect(vi.mocked(publishAnnouncement).mock.calls[0]![1]).toBe(
      "2026-09-03T08:00:01Z",
    );
  });
});
