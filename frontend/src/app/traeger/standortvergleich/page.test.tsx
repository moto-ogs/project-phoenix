import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import type { TraegerComparison } from "~/lib/traeger-comparison-api";

const {
  mockFetchComparison,
  mockFetchSchools,
  mockDownload,
  mockDownloadBlob,
  mockUseSession,
} = vi.hoisted(() => ({
  mockFetchComparison: vi.fn(),
  mockFetchSchools: vi.fn(),
  mockDownload: vi.fn(),
  mockDownloadBlob: vi.fn(),
  mockUseSession: vi.fn(),
}));

vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path,
}));
vi.mock("next-auth/react", () => ({ useSession: mockUseSession }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/standortvergleich",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("~/lib/traeger-comparison-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/traeger-comparison-api")>()),
  fetchTraegerComparison: mockFetchComparison,
  downloadTraegerComparison: mockDownload,
}));
vi.mock("~/lib/traeger-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/traeger-api")>()),
  fetchTraegerSchools: mockFetchSchools,
}));
vi.mock("~/lib/file-download", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/file-download")>()),
  downloadBlob: mockDownloadBlob,
}));
// recharts measures its container, which jsdom does not lay out.
vi.mock("~/components/traeger/comparison-chart", () => ({
  ComparisonChart: ({
    entries,
  }: {
    entries: readonly { school: { name: string }; value: number }[];
  }) => (
    <ol aria-label="Rangfolge">
      {entries.map((entry) => (
        <li key={entry.school.name}>{entry.school.name}</li>
      ))}
    </ol>
  ),
}));
vi.mock("~/env.client", () => ({
  clientEnv: {
    NEXT_PUBLIC_TENANT_DOMAIN: "moto-app.de",
    NEXT_PUBLIC_TRAEGER_HOSTNAME: "traeger.moto-app.de",
  },
}));

import TraegerComparisonPage from "./page";

const SCHOOLS = [
  {
    id: "2",
    name: "OGS Am Bach",
    slug: "am-bach",
    subdomain: "am-bach",
    city: "Bissendorf",
  },
  {
    id: "3",
    name: "OGS Lindenweg",
    slug: "lindenweg",
    subdomain: "lindenweg",
    city: "Melle",
  },
];

const COMPARISON: TraegerComparison = {
  from: "2026-08-13",
  to: "2026-09-09",
  days: 20,
  asOf: "2026-09-09T10:00:00Z",
  attendanceFrom: "2026-09-01",
  schools: [
    {
      ...SCHOOLS[0]!,
      values: {
        places: 40,
        places_rate: 0.95,
        free_places: 2,
        booked: 38,
        present: 30,
        active_students: 41,
      },
      keyDate: "2026-09-08",
    },
    {
      ...SCHOOLS[1]!,
      values: { places: 20, places_rate: 0.55, free_places: 9, booked: 11 },
      keyDate: null,
    },
  ],
  average: {
    places: 30,
    places_rate: 0.75,
    free_places: 5.5,
    booked: 24.5,
    present: 30,
    active_students: 41,
  },
  together: {
    places: 60,
    places_rate: 0.82,
    free_places: 11,
    booked: 49,
    present: 30,
    active_students: 41,
  },
};

function renderPage() {
  return render(
    <ToastProvider>
      <TraegerComparisonPage />
    </ToastProvider>,
  );
}

describe("TraegerComparisonPage", () => {
  beforeEach(() => {
    mockFetchComparison.mockReset();
    mockDownload.mockReset();
    mockDownloadBlob.mockReset();
    mockFetchSchools.mockReset();
    mockFetchSchools.mockResolvedValue(SCHOOLS);
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: "A",
          scope: "org",
          orgId: 7,
          permissions: ["traeger_reports:read"],
        },
      },
      status: "authenticated",
    });
  });

  it("compares the schools of the last four weeks with their average", async () => {
    mockFetchComparison.mockResolvedValue(COMPARISON);
    renderPage();

    const table = await screen.findByRole("table");
    expect(mockFetchComparison).toHaveBeenCalledWith({
      from: "2026-08-13",
      to: "2026-09-09",
      schoolIds: [],
    });
    // 82 % of all places: the tile and the row „Alle zusammen“.
    expect(screen.getAllByText("82 %")).toHaveLength(2);
    expect(screen.getByText("55 % bis 95 %")).toBeInTheDocument();

    const bach = within(table)
      .getByRole("link", { name: "OGS Am Bach" })
      .closest("tr") as HTMLElement;
    expect(within(bach).getByText("95 %")).toBeInTheDocument();
    expect(
      within(bach).getByText("20 Punkte über Schnitt"),
    ).toBeInTheDocument();
    expect(within(bach).getByText("am 08.09.2026")).toBeInTheDocument();
    const linden = within(table)
      .getByRole("link", { name: "OGS Lindenweg" })
      .closest("tr") as HTMLElement;
    expect(
      within(linden).getAllByText("keine Zahl im Zeitraum", { exact: false }),
    ).toHaveLength(2);
    expect(within(table).getByText("Schnitt je Schule")).toBeInTheDocument();
    expect(within(table).getByText("Alle zusammen")).toBeInTheDocument();

    expect(
      within(screen.getByRole("list", { name: "Rangfolge" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["OGS Am Bach", "OGS Lindenweg"]);
    expect(
      screen.getByText(/Check-ins erst ab 01\.09\.2026/),
    ).toBeInTheDocument();
  });

  it("exports the chosen schools and figures", async () => {
    mockFetchComparison.mockResolvedValue(COMPARISON);
    mockDownload.mockResolvedValue({
      blob: new Blob(["x"]),
      filename: "standortvergleich.csv",
    });
    renderPage();
    await screen.findByRole("table");

    await userEvent.click(
      screen.getByRole("button", { name: "Standortvergleich herunterladen" }),
    );
    await userEvent.click(await screen.findByRole("menuitem", { name: /CSV/ }));

    await waitFor(() => expect(mockDownloadBlob).toHaveBeenCalled());
    expect(mockDownload).toHaveBeenCalledWith(
      { from: "2026-08-13", to: "2026-09-09", schoolIds: [] },
      ["places_rate", "free_places", "booked", "present", "active_students"],
    );
  });
});
