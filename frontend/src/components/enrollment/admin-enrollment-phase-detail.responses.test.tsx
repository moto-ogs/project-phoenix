import { resetSWRScope } from "~/lib/swr/scope";
import {
  fireEvent,
  render as renderComponent,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { SWRConfig } from "~/lib/swr/testing";

vi.unmock("swr");

// Reads of the phase and its requests run through real SWR under a staff
// session, a fresh cache per render.
function Providers({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <SessionProvider
      session={{
        user: { id: "staff-7", scope: "tenant", tenantId: "42" },
        expires: "2099-01-01",
      }}
      refetchOnWindowFocus={false}
    >
      <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
        {children}
      </SWRConfig>
    </SessionProvider>
  );
}
const render = (ui: ReactElement) =>
  renderComponent(ui, { wrapper: Providers });

const mocks = vi.hoisted(() => ({
  getCareUsageReport: vi.fn(),
  listAdminRequests: vi.fn(),
  listPhases: vi.fn(),
  responses: undefined as unknown,
  responseError: undefined as Error | undefined,
}));

vi.mock("~/lib/enrollment-admin-api", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, listAdminRequests: mocks.listAdminRequests };
});

// The occupancy section loads on its own; phase-offering-occupancy.test.tsx
// covers it.
vi.mock("~/components/enrollment/phase-offering-occupancy", () => ({
  PhaseOfferingOccupancy: ({ phaseId }: { phaseId: string }) => (
    <div data-testid="phase-offering-occupancy">{phaseId}</div>
  ),
}));

vi.mock("~/lib/enrollment-phase-api", () => ({
  listPhases: mocks.listPhases,
  getPhaseResponseOverview: vi.fn(),
}));

vi.mock("~/lib/enrollment-report-api", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    exportPhaseRegistrations: vi.fn(),
    getCareUsageReport: mocks.getCareUsageReport,
  };
});

// The response overview and the school classes keep their fixtures; the
// phase and its requests read for real.
vi.mock("~/lib/swr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/swr")>();
  return {
    ...actual,
    useSWRAuth: ((
      key: string | null,
      fetcher: () => Promise<unknown>,
      options?: Parameters<typeof actual.useSWRAuth>[2],
    ) =>
      key?.startsWith("enrollment-phase-responses-")
        ? {
            data: mocks.responses,
            error: mocks.responseError,
            isLoading: false,
            mutate: vi.fn(),
          }
        : key === "enrollment-phase-school-classes"
          ? {
              data: ["1a"],
              error: undefined,
              isLoading: false,
              mutate: vi.fn(),
            }
          : actual.useSWRAuth(
              key,
              fetcher,
              options,
            )) as typeof actual.useSWRAuth,
  };
});

vi.mock("~/lib/tenant-context", () => ({
  useCareOfferingsEnabled: () => true,
  useTenantRoutingModeSafe: () => "path",
  useTenantSlugSafe: () => "demo",
}));

vi.mock("~/components/ui/back-link", () => ({
  BackLink: () => null,
}));

// Load errors run through the real hooks (#2515).
vi.mock("~/contexts/ToastContext", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
  useApiErrorDisplay: () => ({ show: vi.fn() }),
}));

vi.mock("~/lib/breadcrumb-context", () => ({
  useSetBreadcrumb: vi.fn(),
}));

vi.mock("~/lib/enrollment-public-url", () => ({
  useEnrollmentPublicUrl: () => "http://demo.localhost:3000/anmeldung/1",
}));

vi.mock("~/lib/student-api", () => ({
  fetchSchoolClasses: vi.fn(() => Promise.resolve([])),
}));

vi.mock("~/components/enrollment/phase-response-overview", () => ({
  PhaseResponseOverview: ({ search }: { search: string }) => (
    <div data-testid="response-overview">Suche: {search}</div>
  ),
}));

import { useInvalidateFamily } from "~/lib/swr";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";

function ReloadPhase() {
  const invalidate = useInvalidateFamily();
  return (
    <button onClick={() => void invalidate(enrollmentKeys.adminRequests("1"))}>
      Reload phase
    </button>
  );
}

import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";
import { AdminEnrollmentPhaseDetail } from "./admin-enrollment-phase-detail";

const phase = {
  id: "1",
  name: "Anmeldung 2027/2028",
  kind: "school_year",
  service_start_date: "2027-08-01",
  service_end_date: "2028-07-31",
  enrollment_open_at: null,
  enrollment_close_at: null,
  form_schema_id: null,
  show_status_reason_to_parent: false,
  care_overflow_mode: "waitlist",
  care_offering_selection_mode: "optional",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const emptyReport = {
  phase: { id: "1", name: phase.name },
  filters: { phase_id: "1", status: "all", care_offering_ids: [] },
  totals: {
    children: 0,
    by_day_count: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
  },
  by_offering: [],
  filter_options: { offerings: [], grade_levels: [] },
  rows: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  resetSWRScope({ revalidate: false });
  mocks.listPhases.mockResolvedValue([phase]);
  mocks.listAdminRequests.mockResolvedValue([]);
  mocks.getCareUsageReport.mockResolvedValue(emptyReport);
  mocks.responseError = undefined;
  mocks.responses = {
    applicable: true,
    expected: 100,
    responded: 80,
    children: [],
    excluded: [],
  };
});

describe("AdminEnrollmentPhaseDetail: Rücklauf (#3379)", () => {
  it("adds the tab with the number of children still missing", async () => {
    render(<AdminEnrollmentPhaseDetail phaseId="1" />);

    const tab = await screen.findByRole("tab", { name: /Rücklauf/ });
    expect(tab).toHaveTextContent("20");
    expect(
      screen.getByRole("tab", { name: /Anmeldungen/ }),
    ).toBeInTheDocument();
    // The list of requests stays the first thing the school sees.
    expect(screen.queryByTestId("response-overview")).not.toBeInTheDocument();
  });

  it("shows the overview on its tab and hands it the page search", async () => {
    render(<AdminEnrollmentPhaseDetail phaseId="1" />);

    fireEvent.click(await screen.findByRole("tab", { name: /Rücklauf/ }));

    expect(await screen.findByTestId("response-overview")).toBeInTheDocument();
    fireEvent.change(
      screen.getAllByPlaceholderText("Nach Kind oder Klasse suchen…")[0]!,
      { target: { value: "arslan" } },
    );
    await waitFor(() =>
      expect(screen.getByTestId("response-overview")).toHaveTextContent(
        "Suche: arslan",
      ),
    );
  });

  it("has no tab for a phase that does not pin existing children", async () => {
    mocks.responses = {
      applicable: false,
      expected: 0,
      responded: 0,
      children: [],
      excluded: [],
    };
    render(<AdminEnrollmentPhaseDetail phaseId="1" />);

    expect(await screen.findByText("Anmeldung 2027/2028")).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: /Rücklauf/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the response error while keeping the registrations available", async () => {
    mocks.responses = undefined;
    mocks.responseError = new ApiError("responses failed", 503, {
      code: "general.unavailable",
    });
    render(<AdminEnrollmentPhaseDetail phaseId="1" />);

    expect(await screen.findByText("Anmeldung 2027/2028")).toBeInTheDocument();
    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die Rücklaufübersicht"),
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: /Rücklauf/ }),
    ).not.toBeInTheDocument();
    // Einmal in der Statuszeile, einmal als Kennzahl über den Eingängen.
    expect(screen.getAllByText("Eingänge")).toHaveLength(2);
  });
});

it("keeps refused phase data hidden through a later transient failure and recovers on success", async () => {
  render(
    <>
      <ReloadPhase />
      <AdminEnrollmentPhaseDetail phaseId="1" />
    </>,
  );
  expect(await screen.findByText(phase.name)).toBeVisible();
  mocks.listAdminRequests.mockRejectedValue(new ApiError("denied", 403));
  fireEvent.click(screen.getByRole("button", { name: "Reload phase" }));
  const refusalText = catalogText("general.permission", "die Anmeldephase");
  expect(await screen.findByText(refusalText)).toBeVisible();
  expect(screen.queryByText(phase.name)).not.toBeInTheDocument();
  mocks.listAdminRequests.mockRejectedValue(new ApiError("offline", 503));
  fireEvent.click(screen.getByRole("button", { name: "Reload phase" }));
  await waitFor(() => expect(mocks.listAdminRequests).toHaveBeenCalledTimes(3));
  expect(await screen.findByText(refusalText)).toBeVisible();
  expect(screen.queryByText(phase.name)).not.toBeInTheDocument();
  mocks.listAdminRequests.mockResolvedValue([]);
  fireEvent.click(screen.getByRole("button", { name: "Reload phase" }));
  expect(await screen.findByText(phase.name)).toBeVisible();
});
