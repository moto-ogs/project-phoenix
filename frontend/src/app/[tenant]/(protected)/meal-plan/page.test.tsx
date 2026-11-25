import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { deferred } from "~/test/helpers/form-modal-pending";
import { catalogText } from "~/test/error-catalog-text";
import { SAVED_BUT_STALE_SUFFIX } from "~/lib/hooks/use-refresh-after-write";
import type { MealPlanDay } from "~/lib/meal-plan-api";

import { SWRConfig } from "~/lib/swr/testing";

import MealPlanPage from "./page-content";

vi.unmock("swr");

function FreshSwrCache({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
      {children}
    </SWRConfig>
  );
}

const { getMealPlanWeek, getMealOrders, setDay, rights, features } = vi.hoisted(
  () => ({
    features: { mealPlanEnabled: true },
    rights: { admin: true, permissions: [] as string[] },
    getMealPlanWeek: vi.fn(),
    getMealOrders: vi.fn(),
    setDay: vi.fn(),
  }),
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/schule/meal-plan",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "1", roles: ["admin"] } },
    status: "authenticated",
  }),
}));

vi.mock("~/lib/auth-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth-utils")>()),
  isAdmin: () => rights.admin,
  hasPermission: (_session: unknown, permission: string) =>
    rights.permissions.includes(permission),
}));

vi.mock("~/lib/tenant-router", () => ({
  useTenantRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("~/lib/hooks/use-navigation-guard", () => ({
  useNavigationGuard: () => ({
    pendingHref: null,
    confirmNavigation: vi.fn(),
    cancelNavigation: vi.fn(),
  }),
}));

vi.mock("~/lib/hooks/use-berlin-today", () => ({
  useBerlinToday: () => "2026-10-06",
}));

vi.mock("~/lib/meal-plan-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/meal-plan-api")>()),
  getMealPlanWeek,
  getMealOrders,
  setDay,
}));

vi.mock("~/lib/tenant-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/tenant-context")>()),
  useMealPlanEnabled: () => features.mealPlanEnabled,
  useMealRegistrationEnabled: () => true,
}));
vi.mock("~/components/meal-plan/meal-participant-list", () => ({
  MealParticipantList: ({
    canRegister,
    canExport,
  }: {
    canRegister: boolean;
    canExport: boolean;
  }) => (
    <div
      data-testid="participants"
      data-register={String(canRegister)}
      data-export={String(canExport)}
    />
  ),
}));

// One stored day as the days read answers it. Its version follows its
// dishes, as the server's does.
function day(date: string, ...dishes: string[]): MealPlanDay {
  return {
    date,
    version: `${date}:${dishes.join("|")}`,
    dishes: dishes.map((dish) => ({ dish, note: null, allergens: [] })),
  };
}

function renderPage() {
  return render(
    <ToastProvider>
      <MealPlanPage />
    </ToastProvider>,
    { wrapper: FreshSwrCache },
  );
}

describe("Speiseplan: Statuszeile bei Ladefehler (#2517)", () => {
  beforeEach(() => {
    getMealPlanWeek.mockReset();
    getMealOrders.mockReset();
    getMealOrders.mockResolvedValue({
      rhythm: "daily",
      detail: "total",
      days: [],
    });
    rights.admin = true;
    rights.permissions = [];
  });

  it("shows the catalog load error and no planned-days count", async () => {
    getMealPlanWeek.mockRejectedValue(
      new ApiError("week exploded", 503, { code: "general.unavailable" }),
    );

    renderPage();

    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die Woche im Speiseplan"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Tagen geplant/)).not.toBeInTheDocument();
    // Kalenderwoche und Zeitraum hängen nicht an den Daten und bleiben.
    expect(screen.getByText(/KW 41/)).toBeInTheDocument();
  });

  it("counts the planned days of a loaded week", async () => {
    getMealPlanWeek.mockResolvedValue([]);

    renderPage();

    expect(
      await screen.findByText(/0 von 5 Tagen geplant/),
    ).toBeInTheDocument();
  });
});

// Der Wochenwechsel steuert Wochenplan und Bestellung und steht darum als
// Bedienband in der Kopfkarte (Bauart 3 Regel 1, TENANT-PAGE-SPEC Regel 3).
describe("Speiseplan: Wochenwechsel im Seitenkopf", () => {
  beforeEach(() => {
    getMealPlanWeek.mockReset();
    getMealPlanWeek.mockResolvedValue([]);
    getMealOrders.mockReset();
    getMealOrders.mockResolvedValue({
      rhythm: "daily",
      detail: "total",
      days: [],
    });
    rights.admin = true;
    rights.permissions = [];
    features.mealPlanEnabled = true;
  });

  it("names the week once in the head bar, not again in the status line", async () => {
    renderPage();

    // Die Statuszeile trägt nur noch die geplanten Tage.
    expect(
      await screen.findByText("0 von 5 Tagen geplant"),
    ).toBeInTheDocument();
    expect(screen.getByText("KW 41 · 05.10.–09.10.2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Diese Woche" })).toBeDisabled();
  });

  it("switches plan and order together and returns to this week", async () => {
    renderPage();
    await screen.findByText("0 von 5 Tagen geplant");

    fireEvent.click(screen.getByRole("button", { name: "Nächste Woche" }));

    await waitFor(() =>
      expect(getMealPlanWeek).toHaveBeenLastCalledWith("2026-10-12"),
    );
    await waitFor(() =>
      expect(getMealOrders).toHaveBeenLastCalledWith(
        "2026-10-12",
        "2026-10-16",
      ),
    );
    expect(
      await screen.findByText("KW 42 · 12.10.–16.10.2026"),
    ).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Diese Woche" }));
    await waitFor(() =>
      expect(getMealPlanWeek).toHaveBeenLastCalledWith("2026-10-05"),
    );
  });

  it("orders the cards: plan, order, caterer, day list last", async () => {
    renderPage();

    const plan = await screen.findByRole("heading", { name: "Wochenplan" });
    const order = await screen.findByRole("heading", { name: "Bestellung" });
    const caterer = await screen.findByRole("heading", { name: "Caterer" });
    const list = await screen.findByTestId("participants");
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(plan, order)).toBe(true);
    expect(follows(order, caterer)).toBe(true);
    expect(follows(caterer, list)).toBe(true);
  });
});

describe("meal registration permissions", () => {
  it.each([
    [["meals:register"], "true", "false"],
    [["meals:orders"], "false", "true"],
  ] as const)(
    "keeps registration independent of export rights (%j)",
    async (permissions, register, exporting) => {
      rights.admin = false;
      rights.permissions = [...permissions];
      getMealPlanWeek.mockResolvedValue([]);
      renderPage();
      const list = await screen.findByTestId("participants");
      expect(list).toHaveAttribute("data-register", register);
      expect(list).toHaveAttribute("data-export", exporting);
    },
  );
});

describe("meal plan feature gate", () => {
  beforeEach(() => {
    getMealPlanWeek.mockReset();
    getMealPlanWeek.mockResolvedValue([]);
    rights.admin = true;
    rights.permissions = [];
    features.mealPlanEnabled = true;
  });

  it("waits for meal planning to be enabled before loading the week", async () => {
    features.mealPlanEnabled = false;
    const { rerender } = renderPage();

    expect(screen.getByText("Speiseplan")).toBeInTheDocument();
    expect(getMealPlanWeek).not.toHaveBeenCalled();

    features.mealPlanEnabled = true;
    rerender(
      <ToastProvider>
        <MealPlanPage />
      </ToastProvider>,
    );

    expect(
      await screen.findByText(/0 von 5 Tagen geplant/),
    ).toBeInTheDocument();
    expect(getMealPlanWeek).toHaveBeenCalledOnce();
    expect(getMealPlanWeek).toHaveBeenCalledWith("2026-10-05");
  });
});

describe("Speiseplan: Allergene je Gericht (#4777)", () => {
  beforeEach(() => {
    getMealPlanWeek.mockReset();
    setDay.mockReset();
    setDay.mockResolvedValue(day("2026-10-05", "gespeichert"));
  });

  it("shows the stored marks and saves the chosen allergens", async () => {
    getMealPlanWeek.mockResolvedValue([
      {
        date: "2026-10-05",
        version: "v-read",
        dishes: [
          { dish: "Fischstäbchen", note: null, allergens: ["gluten", "fish"] },
        ],
      },
    ]);

    renderPage();

    // Every dish card carries its own choice; the Monday dish shows its
    // letters, and its name spells the allergens out for screen readers.
    const trigger = await screen.findByRole("combobox", {
      name: "Allergene: Glutenhaltiges Getreide, Fisch",
    });
    expect(trigger).toHaveTextContent("A, D");
    expect(
      screen.getAllByRole("combobox", { name: "Allergene wählen" }),
    ).toHaveLength(4);
    // The legend under the plan explains the letters used this week.
    const legend = screen.getByRole("list", { name: "Allergene" });
    expect(legend).toHaveTextContent("A Glutenhaltiges Getreide");
    expect(legend).toHaveTextContent("D Fisch");
    expect(legend).not.toHaveTextContent("Milch");

    fireEvent.click(trigger);
    fireEvent.click(screen.getByLabelText("Milch (auch Laktose) (G)"));
    expect(trigger).toHaveTextContent("A, D, G");
    expect(legend).toHaveTextContent("G Milch (auch Laktose)");
    expect(trigger).toHaveAccessibleName(
      "Allergene: Glutenhaltiges Getreide, Fisch, Milch (auch Laktose)",
    );

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(setDay).toHaveBeenCalledTimes(1));
    // The day goes out with the version the page read (general.changed_since_read).
    expect(setDay).toHaveBeenCalledWith(
      "2026-10-05",
      [
        {
          dish: "Fischstäbchen",
          note: null,
          allergens: ["gluten", "fish", "milk"],
        },
      ],
      "v-read",
    );
  });
});

// #6652: a write holds once it is through; a failed reload keeps the week
// on screen and says the change is saved, and its retry only reloads.
describe("reload after a write (#6652)", () => {
  const reloadText = `${catalogText("general.unavailable", "die Anzeige des Speiseplans")} ${SAVED_BUT_STALE_SUFFIX}`;
  const stored = day("2026-10-05", "Fischstäbchen");

  beforeEach(() => {
    getMealPlanWeek
      .mockReset()
      .mockResolvedValueOnce([stored])
      .mockRejectedValueOnce(
        new ApiError("down", 503, { code: "general.unavailable" }),
      )
      .mockResolvedValue([day("2026-10-05", "Nudeln")]);
    getMealOrders.mockReset().mockResolvedValue({
      rhythm: "daily",
      detail: "total",
      days: [],
    });
    setDay.mockReset().mockResolvedValue(day("2026-10-05", "Nudeln"));
    rights.admin = true;
    rights.permissions = [];
    features.mealPlanEnabled = true;
  });

  // The save answers the day's new version: the same day saves again
  // against it, also when the week could not be read after the save.
  it("saves the same day again with the version its save answered", async () => {
    renderPage();
    fireEvent.change(await screen.findByDisplayValue("Fischstäbchen"), {
      target: { value: "Nudeln" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await screen.findByText(reloadText);
    expect(setDay).toHaveBeenLastCalledWith(
      "2026-10-05",
      [{ dish: "Nudeln", note: null, allergens: [] }],
      stored.version,
    );

    fireEvent.change(screen.getByDisplayValue("Nudeln"), {
      target: { value: "Suppe" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(setDay).toHaveBeenCalledTimes(2));
    expect(setDay).toHaveBeenLastCalledWith(
      "2026-10-05",
      [{ dish: "Suppe", note: null, allergens: [] }],
      day("2026-10-05", "Nudeln").version,
    );
  });

  it("keeps a saved week saved when the reload fails", async () => {
    renderPage();
    fireEvent.change(await screen.findByDisplayValue("Fischstäbchen"), {
      target: { value: "Nudeln" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Speichern" }));

    const reloadAlert = (
      await screen.findByText(reloadText)
    ).closest<HTMLElement>('[role="alert"]');
    expect(reloadAlert).not.toBeNull();
    // Anker: die gespeicherte Woche steht noch da.
    expect(screen.getByDisplayValue("Nudeln")).toBeInTheDocument();
    expect(screen.getByText("1 von 5 Tagen geplant")).toBeInTheDocument();
    expect(
      screen.queryByText(
        catalogText("general.unavailable", "die Woche im Speiseplan"),
      ),
    ).not.toBeInTheDocument();
    // Die gespeicherten Tage gelten nicht mehr als geändert.
    expect(screen.queryByText("1 Tag geändert")).not.toBeInTheDocument();
    expect(setDay).toHaveBeenCalledTimes(1);

    // Andere Karten der Seite (Caterer) laden ungemockt und können ein
    // eigenes „Wiederholen“ zeigen; geklickt wird das des Nachladefehlers.
    fireEvent.click(
      within(reloadAlert!).getByRole("button", { name: "Wiederholen" }),
    );
    await waitFor(() => expect(getMealPlanWeek).toHaveBeenCalledTimes(3));
    expect(await screen.findByDisplayValue("Nudeln")).toBeInTheDocument();
    expect(setDay).toHaveBeenCalledTimes(1);
  });

  it("confirms dirty drafts before retrying and locks edits during the retry", async () => {
    renderPage();
    fireEvent.change(await screen.findByDisplayValue("Fischstäbchen"), {
      target: { value: "Nudeln" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    const alert = (await screen.findByText(reloadText)).closest<HTMLElement>(
      '[role="alert"]',
    )!;
    const pending = deferred<(typeof stored)[]>();
    getMealPlanWeek.mockReturnValueOnce(pending.promise);
    fireEvent.change(screen.getByDisplayValue("Nudeln"), {
      target: { value: "Neuer Entwurf" },
    });
    fireEvent.click(within(alert).getByRole("button", { name: "Wiederholen" }));

    const dialog = await screen.findByRole("dialog");
    expect(getMealPlanWeek).toHaveBeenCalledTimes(2);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Hierbleiben" }),
    );
    expect(screen.getByDisplayValue("Neuer Entwurf")).toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "Wiederholen" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Verwerfen & neu laden",
      }),
    );
    await waitFor(() => expect(getMealPlanWeek).toHaveBeenCalledTimes(3));
    expect(screen.getByDisplayValue("Neuer Entwurf")).toHaveAttribute(
      "readonly",
    );
    pending.resolve([day("2026-10-05", "Gespeicherter Plan")]);
    expect(
      await screen.findByDisplayValue("Gespeicherter Plan"),
    ).not.toHaveAttribute("readonly");
    expect(setDay).toHaveBeenCalledTimes(1);
  });
});

// A week reopened from the cache shows at once and stays editable while it
// is read again; the save sends the day as read, so the backend refuses a
// day someone changed since (general.changed_since_read) instead of the page waiting.
describe("Speiseplan: Woche aus dem Cache beim erneuten Öffnen", () => {
  const stored = day("2026-10-05", "Fischstäbchen");

  beforeEach(() => {
    getMealPlanWeek.mockReset().mockResolvedValueOnce([stored]);
    getMealOrders.mockReset().mockResolvedValue({
      rhythm: "daily",
      detail: "total",
      days: [],
    });
    rights.admin = true;
    rights.permissions = [];
    features.mealPlanEnabled = true;
  });

  async function visitTwice() {
    const cache = new Map();
    function SharedCache({ children }: { children: React.ReactNode }) {
      return (
        <SWRConfig value={{ provider: () => cache, errorRetryCount: 0 }}>
          {children}
        </SWRConfig>
      );
    }
    const page = (
      <ToastProvider>
        <MealPlanPage />
      </ToastProvider>
    );
    const first = render(page, { wrapper: SharedCache });
    expect(
      await screen.findByDisplayValue("Fischstäbchen"),
    ).not.toHaveAttribute("readonly");
    first.unmount();
    render(page, { wrapper: SharedCache });
  }

  it("shows the cached week at once and takes the newer read", async () => {
    const pending = deferred<(typeof stored)[]>();
    getMealPlanWeek.mockReturnValueOnce(pending.promise);

    await visitTwice();

    // Anker: the cached week is editable while it is read again.
    expect(screen.getByDisplayValue("Fischstäbchen")).not.toHaveAttribute(
      "readonly",
    );
    await waitFor(() => expect(getMealPlanWeek).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("status", {
        name: "Der Bereich „Speiseplan“ wird geladen…",
      }),
    ).not.toBeInTheDocument();

    pending.resolve([day("2026-10-05", "Nudeln")]);
    expect(await screen.findByDisplayValue("Nudeln")).not.toHaveAttribute(
      "readonly",
    );
  });

  it("drops discarded edits when the person returns after the next week failed to load", async () => {
    getMealPlanWeek
      .mockRejectedValueOnce(
        new ApiError("down", 503, { code: "general.unavailable" }),
      )
      .mockResolvedValue([stored]);
    renderPage();
    fireEvent.change(await screen.findByDisplayValue("Fischstäbchen"), {
      target: { value: "Nudeln" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Nächste Woche" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Verwerfen & wechseln",
      }),
    );
    // Anker: die nächste Woche ist mit ihrem Ladefehler auf dem Bildschirm.
    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die Woche im Speiseplan"),
      ),
    ).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Diese Woche" }));
    expect(
      await screen.findByDisplayValue("Fischstäbchen"),
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Nudeln")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Speichern" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the cached week when its background read fails", async () => {
    getMealPlanWeek.mockRejectedValueOnce(
      new ApiError("down", 503, { code: "general.unavailable" }),
    );

    await visitTwice();

    await waitFor(() => expect(getMealPlanWeek).toHaveBeenCalledTimes(2));
    expect(screen.getByDisplayValue("Fischstäbchen")).not.toHaveAttribute(
      "readonly",
    );
    expect(
      screen.queryByText(
        catalogText("general.unavailable", "die Woche im Speiseplan"),
      ),
    ).not.toBeInTheDocument();
  });

  it("shows the stored day it refused instead of keeping the draft over it", async () => {
    const colleague = day("2026-10-05", "Eintopf");
    getMealPlanWeek.mockReset().mockResolvedValueOnce([stored]);
    getMealPlanWeek.mockResolvedValue([colleague]);
    setDay
      .mockReset()
      .mockRejectedValue(
        new ApiError("changed", 409, { code: "general.changed_since_read" }),
      );
    renderPage();
    fireEvent.change(await screen.findByDisplayValue("Fischstäbchen"), {
      target: { value: "Nudeln" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(
        catalogText("general.changed_since_read", "die Woche im Speiseplan"),
      ),
    ).toBeInTheDocument();
    expect(setDay).toHaveBeenLastCalledWith(
      "2026-10-05",
      [{ dish: "Nudeln", note: null, allergens: [] }],
      stored.version,
    );
    // The colleague's change is on screen and nothing is left to save, so
    // no second „Speichern“ can replace it unseen.
    expect(await screen.findByDisplayValue("Eintopf")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Nudeln")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Speichern" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the draft of an unsaved day nobody changed since it was read", async () => {
    const tuesday = day("2026-10-06", "Linsen");
    getMealPlanWeek.mockReset().mockResolvedValueOnce([stored, tuesday]);
    getMealPlanWeek.mockResolvedValue([day("2026-10-05", "Eintopf"), tuesday]);
    setDay
      .mockReset()
      .mockRejectedValueOnce(
        new ApiError("changed", 409, { code: "general.changed_since_read" }),
      )
      .mockResolvedValue(day("2026-10-06", "Reis"));
    renderPage();
    fireEvent.change(await screen.findByDisplayValue("Fischstäbchen"), {
      target: { value: "Nudeln" },
    });
    fireEvent.change(screen.getByDisplayValue("Linsen"), {
      target: { value: "Reis" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await screen.findByText(
      catalogText("general.changed_since_read", "die Woche im Speiseplan"),
    );

    // Monday was refused and shows the stored change; Tuesday is stored as
    // read, so its draft stays and saves against the same version.
    expect(await screen.findByDisplayValue("Eintopf")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Nudeln")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Reis")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(setDay).toHaveBeenCalledTimes(2));
    expect(setDay).toHaveBeenLastCalledWith(
      "2026-10-06",
      [{ dish: "Reis", note: null, allergens: [] }],
      tuesday.version,
    );
  });

  it("shows a colleague's change on a day the person did not edit", async () => {
    const tuesday = day("2026-10-06", "Linsen");
    getMealPlanWeek.mockReset().mockResolvedValueOnce([stored, tuesday]);
    getMealPlanWeek.mockResolvedValue([
      day("2026-10-05", "Eintopf"),
      day("2026-10-06", "Reis"),
    ]);
    setDay
      .mockReset()
      .mockRejectedValue(
        new ApiError("changed", 409, { code: "general.changed_since_read" }),
      );
    renderPage();
    fireEvent.change(await screen.findByDisplayValue("Fischstäbchen"), {
      target: { value: "Nudeln" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await screen.findByText(
      catalogText("general.changed_since_read", "die Woche im Speiseplan"),
    );

    expect(await screen.findByDisplayValue("Reis")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Linsen")).not.toBeInTheDocument();
  });

  // Each day is its own save: when one fails after another was stored, the
  // stored day is not sent again on its old version, and the unsent day
  // keeps its draft while nobody changed it (ADR 0311).
  it("saves the rest of a week a failure stopped halfway", async () => {
    const tuesday = day("2026-10-06", "Linsen");
    getMealPlanWeek
      .mockReset()
      .mockResolvedValueOnce([stored, tuesday])
      .mockResolvedValue([day("2026-10-05", "Nudeln"), tuesday]);
    setDay
      .mockReset()
      .mockResolvedValueOnce(day("2026-10-05", "Nudeln"))
      .mockRejectedValueOnce(
        new ApiError("down", 503, { code: "general.unavailable" }),
      )
      .mockResolvedValue(day("2026-10-06", "Reis"));
    renderPage();
    fireEvent.change(await screen.findByDisplayValue("Fischstäbchen"), {
      target: { value: "Nudeln" },
    });
    fireEvent.change(screen.getByDisplayValue("Linsen"), {
      target: { value: "Reis" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await screen.findByText((text) =>
      text.includes(
        catalogText("general.unavailable", "die Woche im Speiseplan"),
      ),
    );
    expect(await screen.findByText("1 Tag geändert")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Nudeln")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Reis")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(setDay).toHaveBeenCalledTimes(3));
    expect(setDay).toHaveBeenLastCalledWith(
      "2026-10-06",
      [{ dish: "Reis", note: null, allergens: [] }],
      tuesday.version,
    );
  });

  it("shows the failed read after a conflict, not an old week to discard to", async () => {
    getMealPlanWeek
      .mockReset()
      .mockResolvedValueOnce([stored])
      .mockRejectedValueOnce(
        new ApiError("week exploded", 503, { code: "general.unavailable" }),
      )
      .mockResolvedValue([day("2026-10-05", "Eintopf")]);
    setDay
      .mockReset()
      .mockRejectedValue(
        new ApiError("changed", 409, { code: "general.changed_since_read" }),
      );
    renderPage();
    fireEvent.change(await screen.findByDisplayValue("Fischstäbchen"), {
      target: { value: "Nudeln" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    const failedRead = await screen.findByText((text) =>
      text.includes(
        catalogText("general.unavailable", "die Woche im Speiseplan"),
      ),
    );
    expect(failedRead).toBeInTheDocument();
    expect(
      screen.queryByText(
        catalogText("general.changed_since_read", "die Woche im Speiseplan"),
      ),
    ).not.toBeInTheDocument();

    // ADR 0311 rules 4 and 6: the retry reads the week again, it never
    // sends the refused versions; saving waits for the stored week.
    fireEvent.click(
      within(failedRead.closest<HTMLElement>("[role=alert]")!).getByRole(
        "button",
        { name: "Wiederholen" },
      ),
    );
    await waitFor(() => expect(getMealPlanWeek).toHaveBeenCalledTimes(3));
    expect(setDay).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(
        catalogText("general.changed_since_read", "die Woche im Speiseplan"),
      ),
    ).toBeInTheDocument();
  });
});

// „Vorwoche übernehmen“ copies only the dishes: each day of this week saves
// against the version it was read with in this week.
describe("Speiseplan: Vorwoche übernehmen", () => {
  beforeEach(() => {
    getMealPlanWeek
      .mockReset()
      .mockImplementation(async (monday: string) =>
        monday === "2026-09-28"
          ? [day("2026-09-28", "Gulasch")]
          : [day("2026-10-05")],
      );
    getMealOrders.mockReset().mockResolvedValue({
      rhythm: "daily",
      detail: "total",
      days: [],
    });
    setDay.mockReset().mockResolvedValue(day("2026-10-05", "Gulasch"));
    rights.admin = true;
    rights.permissions = [];
    features.mealPlanEnabled = true;
  });

  it("saves the copied dishes against this week's versions", async () => {
    renderPage();
    await screen.findByText("0 von 5 Tagen geplant");
    fireEvent.click(
      screen.getByRole("button", { name: "Vorwoche übernehmen" }),
    );
    expect(await screen.findByDisplayValue("Gulasch")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(setDay).toHaveBeenCalledTimes(1));
    expect(setDay).toHaveBeenCalledWith(
      "2026-10-05",
      [{ dish: "Gulasch", note: null, allergens: [] }],
      day("2026-10-05").version,
    );
  });
});
