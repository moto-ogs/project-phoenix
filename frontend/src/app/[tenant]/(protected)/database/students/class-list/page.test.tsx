import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ClassListPage from "./page";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/test-tenant/database/students/class-list",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "authenticated" }),
}));

const auth = vi.hoisted(() => ({ permitted: false }));
vi.mock("~/lib/auth-utils", () => ({
  hasPermission: () => auth.permitted,
}));

const api = vi.hoisted(() => ({
  updateClassListEntry: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock("~/lib/class-list-entries-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/class-list-entries-api")>()),
  updateClassListEntry: api.updateClassListEntry,
}));

vi.mock("~/lib/tenant-path", () => ({
  useTenantAwarePath: () => (path: string) => path,
}));

interface SwrSlot {
  data: unknown;
  error: unknown;
  isLoading: boolean;
  mutate: ReturnType<typeof vi.fn>;
}

const swr = vi.hoisted(() => new Map<string, SwrSlot>());
vi.mock("~/lib/swr", () => ({
  useSWRAuth: (key: string) => swr.get(key),
  useTenantMutate: () => vi.fn(() => Promise.resolve()),
  // The read of the stored state after a refusal (ADR 0311).
  revalidateOrThrow: (read: SwrSlot) =>
    (read.mutate as () => Promise<unknown>)(),
}));

function slot(data: unknown, error?: unknown): SwrSlot {
  return {
    data,
    error,
    isLoading: false,
    mutate: vi.fn(() => Promise.resolve(undefined)),
  };
}

const unavailable = () =>
  new ApiError("load exploded", 503, { code: "general.unavailable" });

const entry = {
  id: "e1",
  firstName: "Lea",
  lastName: "Ohne",
  schoolClass: "1a",
  matchingStudentIds: [],
  version: "v1",
};

function renderPage() {
  return render(
    <ToastProvider>
      <ClassListPage />
    </ToastProvider>,
  );
}

beforeEach(() => {
  swr.clear();
  swr.set("class-list-class-suggestions", slot([]));
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  auth.permitted = false;
});

describe("Klassenliste: Eintrag bearbeiten (ADR 0311)", () => {
  it("saves on the entry as read and shows the stored entry after a refusal", async () => {
    auth.permitted = true;
    const stored = { ...entry, firstName: "Leah", version: "v2" };
    const entries = slot([entry]);
    // A read answers the stored entry, as SWR's cache then holds it.
    entries.mutate.mockImplementation(async () => {
      entries.data = [stored];
      return [stored];
    });
    swr.set("class-list-entries", entries);
    swr.set("class-list-roster-students", slot([]));
    api.updateClassListEntry
      .mockRejectedValueOnce(
        new ApiError("changed", 409, { code: "general.changed_since_read" }),
      )
      .mockResolvedValueOnce({ ...stored, lastName: "Neu", version: "v3" });

    renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: "Aktionen für Lea Ohne" }),
    );
    fireEvent.click(await screen.findByText("Bearbeiten"));
    const firstName = screen.getByLabelText("Vorname");
    expect(firstName).toHaveValue("Lea");
    fireEvent.change(firstName, { target: { value: "Lena" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(api.updateClassListEntry).toHaveBeenCalledWith(
        "e1",
        { firstName: "Lena", lastName: "Ohne", schoolClass: "1a" },
        "v1",
      ),
    );
    // The refusal reads the stored entry and shows it in the dialog.
    await waitFor(() =>
      expect(screen.getByLabelText("Vorname")).toHaveValue("Leah"),
    );
    expect(
      await screen.findByText(
        catalogText("general.changed_since_read", "das Speichern des Eintrags"),
      ),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nachname"), {
      target: { value: "Neu" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(api.updateClassListEntry).toHaveBeenLastCalledWith(
        "e1",
        { firstName: "Leah", lastName: "Neu", schoolClass: "1a" },
        "v2",
      ),
    );
  });
});

describe("Klassenliste: Zähler bei Ladefehler (#2517)", () => {
  it("shows no zero counts next to a failed entries load", async () => {
    swr.set("class-list-entries", slot(undefined, unavailable()));
    swr.set("class-list-roster-students", slot(undefined, unavailable()));

    renderPage();

    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die Klassenliste"),
      ),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/0\s*Kinder/);
    expect(document.body).not.toHaveTextContent(/0\s*ohne\sBetreuung/);
  });

  it("drops the child total when only the roster students failed", async () => {
    swr.set("class-list-entries", slot([entry]));
    swr.set("class-list-roster-students", slot(undefined, unavailable()));

    renderPage();

    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die Liste der angelegten Kinder"),
      ),
    ).toBeInTheDocument();
    // Die Einträge zählen weiter, die Gesamtzahl ohne die angelegten Kinder
    // stünde falsch da.
    // Zahl und Wort stehen in eigenen Elementen, visuell ohne Trennpunkt.
    const withoutCare = screen.getByText("ohne Betreuung");
    expect(withoutCare.parentElement).toHaveTextContent(/^1 ohne Betreuung$/);
    const statusLine = withoutCare.parentElement?.parentElement;
    expect(statusLine).not.toHaveTextContent(/\d+Kind/);
    expect(
      screen.queryByText(/davon sind in moto angelegt/),
    ).not.toBeInTheDocument();
  });

  it("führt zurück zu den Kinderdaten", () => {
    swr.set("class-list-entries", slot([entry]));
    swr.set("class-list-roster-students", slot([]));

    renderPage();

    expect(
      screen.getByRole("link", { name: "Zurück zu den Kinderdaten" }),
    ).toHaveAttribute("href", expect.stringMatching(/\/database\/students$/));
  });

  it("counts entries and roster students once both loaded", () => {
    swr.set("class-list-entries", slot([entry]));
    swr.set(
      "class-list-roster-students",
      slot([
        {
          id: "s1",
          firstName: "Max",
          lastName: "Muster",
          schoolClass: "1a",
        },
      ]),
    );

    renderPage();

    // Zahl und Wort stehen in eigenen Elementen, die Paare ohne Trennpunkt.
    expect(
      screen.getByText("ohne Betreuung").parentElement?.parentElement,
    ).toHaveTextContent(/^2 Kinder, 1 ohne Betreuung/);
    expect(
      screen.getByText(/1 davon sind in moto angelegt/),
    ).toBeInTheDocument();
  });
});
