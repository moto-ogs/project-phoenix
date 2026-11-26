import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PlanningTracksPage from "./page-content";
import { ApiError } from "~/lib/api-error";
import { useTimetableEnabled } from "~/lib/tenant-context";
import { catalogText } from "~/test/error-catalog-text";

vi.mock("~/lib/swr/hooks", () => ({ useDiscardRefusedEntity: () => vi.fn() }));

const searchParams = vi.hoisted(() => ({ value: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/test-tenant/database/planning-tracks",
  useSearchParams: () => searchParams.value,
}));

vi.mock("~/hooks/useUpdateUrlParams", () => ({
  useUpdateUrlParams: () => vi.fn(),
}));

vi.mock("~/contexts/ToastContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/contexts/ToastContext")>()),
  useApiErrorDisplay: () => ({ show: vi.fn() }),
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    remove: vi.fn(),
  }),
}));

const planningTrackService = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  reorder: vi.fn(),
  archive: vi.fn(),
  restore: vi.fn(),
}));
vi.mock("~/lib/planning-track-api", () => ({ planningTrackService }));

vi.mock("~/lib/tenant-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/tenant-context")>()),
  useTimetableEnabled: vi.fn(),
}));

const swrState = vi.hoisted(() => ({
  data: undefined as unknown,
  error: undefined as unknown,
  isLoading: true,
  mutate: vi.fn(),
}));
vi.mock("~/lib/swr", () => ({
  useSWRAuth: () => swrState,
  useTenantMutate: () => vi.fn(() => Promise.resolve()),
}));

beforeEach(() => {
  searchParams.value = new URLSearchParams();
  vi.mocked(useTimetableEnabled).mockReturnValue(true);
  swrState.data = undefined;
  swrState.error = undefined;
  swrState.isLoading = true;
  swrState.mutate = vi.fn(() => Promise.resolve(undefined));
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
});

describe("Planungsspuren", () => {
  it("shows an unavailable state when the care plan is switched off", () => {
    vi.mocked(useTimetableEnabled).mockReturnValue(false);

    render(<PlanningTracksPage />);

    expect(
      screen.getByTestId("planning-tracks-disabled-state"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Planungsspur anlegen" }),
    ).not.toBeInTheDocument();
  });

  it("keeps creating unavailable until the current order has loaded", () => {
    const { rerender } = render(<PlanningTracksPage />);

    for (const action of screen.getAllByRole("button", {
      name: "Planungsspur anlegen",
    })) {
      expect(action).toBeDisabled();
    }

    swrState.data = [
      { id: "1", name: "Jahrgang 1", color: "#5080D8", sortOrder: 0 },
    ];
    swrState.isLoading = false;
    rerender(<PlanningTracksPage />);

    for (const action of screen.getAllByRole("button", {
      name: "Planungsspur anlegen",
    })) {
      expect(action).toBeEnabled();
    }
  });

  // #2516: Katalogtext statt eines eigenen Satzes, nie der Leerzustand.
  it("shows the catalog text of a failed load instead of the empty state", async () => {
    swrState.error = new ApiError("list exploded", 503, {
      code: "general.unavailable",
    });
    swrState.isLoading = false;

    render(<PlanningTracksPage />);

    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die Liste der Planungsspuren"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/list exploded/)).not.toBeInTheDocument();
    // Das Katalog-Kit reicht Wiederholen jetzt bis ins Gerüst durch.
    expect(
      screen.getByRole("button", { name: "Wiederholen" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Noch keine Planungsspuren"),
    ).not.toBeInTheDocument();
  });

  // ADR 0311: das Speichern schickt den Stand der Spur, aus dem das Formular
  // stammt.
  it("saves an edit with the version of the track it edits", async () => {
    searchParams.value = new URLSearchParams("eintrag=1");
    planningTrackService.update.mockResolvedValue({});
    swrState.data = [
      {
        id: "1",
        name: "Jahrgang 1",
        color: "#5080D8",
        sortOrder: 3,
        version: "v7",
      },
    ];
    swrState.isLoading = false;
    render(<PlanningTracksPage />);

    fireEvent.change(screen.getByDisplayValue("Jahrgang 1"), {
      target: { value: "Jahrgang 2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(planningTrackService.update).toHaveBeenCalledWith("1", {
        name: "Jahrgang 2",
        color: "#5080D8",
        sort_order: 3,
        expected_version: "v7",
      }),
    );
  });
});
