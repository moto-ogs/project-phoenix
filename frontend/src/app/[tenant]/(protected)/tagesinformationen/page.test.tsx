import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";

import TagesinformationenPage from "./page";

interface SwrSlot {
  data: unknown;
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
}

const state = vi.hoisted(() => ({
  isAdmin: true,
  today: undefined as unknown as SwrSlot,
  all: undefined as unknown as SwrSlot,
  linked: undefined as unknown as SwrSlot,
  search: "",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/schule/tagesinformationen",
  useSearchParams: () => new URLSearchParams(state.search),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "7" } }, status: "authenticated" }),
}));

vi.mock("~/lib/auth-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth-utils")>()),
  hasEffectiveAdminScope: () => state.isAdmin,
}));

vi.mock("~/lib/swr", () => ({
  useSWRAuth: (key: string | null) =>
    key === null
      ? { data: undefined, error: undefined, isLoading: false, mutate: vi.fn() }
      : key.startsWith("staff-notices-today")
        ? state.today
        : key.startsWith("staff-notice:")
          ? state.linked
          : state.all,
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
  new ApiError("notices exploded", 503, { code: "general.unavailable" });

function renderPage() {
  return render(
    <ToastProvider>
      <TagesinformationenPage />
    </ToastProvider>,
  );
}

describe("Tagesinformationen: Statuszeile bei Ladefehler (#2517)", () => {
  beforeEach(() => {
    state.isAdmin = true;
    state.search = "";
    state.today = slot([]);
    state.all = slot([]);
  });

  it("shows no zero counts when both lists failed to load", async () => {
    state.today = slot(undefined, unavailable());
    state.all = slot(undefined, unavailable());

    renderPage();

    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die Liste der Hinweise von heute"),
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die Liste aller Hinweise"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/0 heute/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 insgesamt/)).not.toBeInTheDocument();
  });

  it("keeps the count of the list that did load", async () => {
    state.all = slot(undefined, unavailable());

    renderPage();

    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die Liste aller Hinweise"),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("0 heute")).toBeInTheDocument();
    expect(screen.queryByText(/insgesamt/)).not.toBeInTheDocument();
  });
});

describe("Tagesinformationen: Hinweis aus der Glocke (#7143)", () => {
  const notice = {
    id: "42",
    title: "Sommerfest",
    body: "Bitte Kuchen mitbringen.",
    priority: "info",
    audience: "all",
    valid_from: "2030-06-25",
    weekdays: [],
    week_pattern: 0,
    requires_acknowledgement: false,
    active: true,
  };

  beforeEach(() => {
    state.isAdmin = false;
    state.today = slot([]);
    state.all = slot([]);
    state.linked = slot(notice);
    state.search = "hinweis=42";
  });

  it("shows the linked notice that does not apply today", () => {
    renderPage();

    expect(
      screen.getByRole("heading", { name: "Hinweis aus der Glocke" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Sommerfest")).toBeInTheDocument();
    expect(screen.getByText("Bitte Kuchen mitbringen.")).toBeInTheDocument();
  });

  it("does not repeat a linked notice that is listed under Heute", () => {
    state.today = slot([notice]);

    renderPage();

    expect(
      screen.queryByRole("heading", { name: "Hinweis aus der Glocke" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Sommerfest")).toHaveLength(1);
  });

  it("explains a deleted or switched off notice", () => {
    state.linked = slot(undefined, new ApiError("not found", 404));

    renderPage();

    expect(
      screen.getByText(
        "Diesen Hinweis gibt es nicht mehr. Die Leitung hat ihn gelöscht oder ausgeschaltet.",
      ),
    ).toBeInTheDocument();
  });
});
