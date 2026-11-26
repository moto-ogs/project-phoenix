import { SWRConfig } from "~/lib/swr/testing";
vi.unmock("swr");
import { render as rtlRender, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import type {
  TraegerOffering,
  TraegerPhaseDetail,
} from "~/lib/traeger-catalog-api";

const { mockFetchPhase, params } = vi.hoisted(() => ({
  mockFetchPhase: vi.fn(),
  params: { id: "7", offeringId: "31" },
}));

vi.mock("~/lib/traeger-catalog-api", () => ({
  fetchTraegerPhase: (id: string) => mockFetchPhase(id),
  fetchTraegerPhases: () => Promise.resolve([]),
  updateTraegerOffering: vi.fn(),
}));
vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path.replace(/^\/traeger/, "") || "/",
}));
vi.mock("next/navigation", () => ({
  useParams: () => params,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "A", scope: "org", orgId: "7" } },
    status: "authenticated",
  }),
}));

import TraegerCatalogOfferingPage from "./page-content";

function render(ui: React.ReactElement) {
  return rtlRender(
    <ToastProvider>
      <SWRConfig value={{ provider: () => new Map() }}>{ui}</SWRConfig>
    </ToastProvider>,
  );
}

const withdrawnOffering = {
  id: "31",
  traegerPhaseId: "7",
  draft: {
    fields: {
      name: "Frühbetreuung",
      description: null,
      availableDays: ["monday", "tuesday"],
      capacity: null,
    },
    prices: [{ weekday: "monday", daysPerWeek: null, monthlyCents: 2500 }],
    contractTemplate: null,
  },
  releasedVersion: 1,
  released: null,
  withdrawnAt: "2027-01-10T10:00:00Z",
  schools: [],
} as unknown as TraegerOffering;

describe("TraegerCatalogOfferingPage (#7413)", () => {
  beforeEach(() => {
    mockFetchPhase.mockReset();
    mockFetchPhase.mockResolvedValue({
      id: "7",
      draft: { name: "Schuljahr 2027/28" },
      withdrawnAt: null,
      offerings: [withdrawnOffering],
    } as unknown as TraegerPhaseDetail);
  });

  it("shows a withdrawn offering read only, without the form", async () => {
    params.offeringId = "31";
    render(<TraegerCatalogOfferingPage />);

    expect(
      await screen.findByText(
        "Ein zurückgezogenes Angebot lässt sich nicht mehr ändern.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Zurückgezogen")).toBeInTheDocument();
    expect(screen.getByText("Ohne Grenze")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Speichern" }),
    ).not.toBeInTheDocument();
  });

  it("says so when the offering does not belong to the phase", async () => {
    params.offeringId = "99";
    render(<TraegerCatalogOfferingPage />);

    expect(
      await screen.findByText(/Dieses Angebot gibt es nicht\./),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Speichern" }),
    ).not.toBeInTheDocument();
  });
});
