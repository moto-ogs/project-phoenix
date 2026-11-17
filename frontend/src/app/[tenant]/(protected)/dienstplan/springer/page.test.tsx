import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "~/contexts/ToastContext";
import { SWRConfig } from "~/lib/swr/testing";
import { ApiError } from "~/lib/api-error";
import { MODULE_KEYS } from "~/lib/modules";
import type { PoolSpringer, PoolWeek } from "~/lib/staff-pool-api";
import type { TenantInfo } from "~/lib/tenant-api";
import { useBookedModules, useTenantSafe } from "~/lib/tenant-context";
import { setTestClock } from "~/test/clock";

vi.unmock("swr");

const api = vi.hoisted(() => ({
  fetchSchoolPoolWeek: vi.fn(),
  blockSpringer: vi.fn(),
  liftSchoolBlock: vi.fn(),
}));

vi.mock("~/lib/staff-pool-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/staff-pool-api")>()),
  ...api,
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { id: "1", token: "test-token" } },
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/dienstplan/springer",
  useSearchParams: () => new URLSearchParams(),
}));

import StaffPoolPage from "./page";

// The fixture week is fixed around Wednesday 2026-09-09 (week from 2026-09-07);
// every test pins the clock to that day.
const LENA: PoolSpringer = {
  recordId: "7",
  firstName: "Lena",
  lastName: "Springer",
  poolFrom: "2026-08-01",
  poolUntil: null,
  proofs: [
    {
      typeName: "Führungszeugnis",
      status: "complete",
      expiresOn: "2030-01-31",
    },
    { typeName: "Masernschutz", status: "missing", expiresOn: null },
  ],
  blocks: [
    {
      id: null,
      schoolId: "2",
      schoolName: "OGS Süd",
      own: false,
      date: "2026-09-10",
      startTime: "08:00",
      endTime: "12:00",
      lifted: false,
    },
    {
      id: "41",
      schoolId: "1",
      schoolName: "OGS Nord",
      own: true,
      date: "2026-09-11",
      startTime: "08:00",
      endTime: "13:00",
      lifted: false,
    },
  ],
};

const WEEK: PoolWeek = {
  weekStart: "2026-09-07",
  today: "2026-09-09",
  available: true,
  springers: [LENA],
};

const TENANT = { tenantId: 1, slug: "demo" } as TenantInfo;

function renderPage() {
  return render(
    <ToastProvider>
      <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
        <StaffPoolPage />
      </SWRConfig>
    </ToastProvider>,
  );
}

describe("StaffPoolPage", () => {
  beforeEach(() => {
    // Fixture week with blocks on Thursday and Friday around this Wednesday.
    setTestClock("2026-09-09T12:00:00+02:00");
    vi.clearAllMocks();
    vi.mocked(useTenantSafe).mockReturnValue({
      tenantSlug: "demo",
      tenant: TENANT,
      routingMode: "subdomain",
    });
    vi.mocked(useBookedModules).mockReturnValue(MODULE_KEYS);
    api.fetchSchoolPoolWeek.mockResolvedValue(WEEK);
  });

  it("shows the Springer with the Nachweise and whose blocks they are", async () => {
    renderPage();
    expect(
      (await screen.findAllByText("Springer, Lena")).length,
    ).toBeGreaterThan(0);
    expect(api.fetchSchoolPoolWeek).toHaveBeenCalledWith("2026-09-07");
    expect(screen.getAllByText("1 Nachweis fehlt").length).toBeGreaterThan(0);
    // Another school's block names only the school and is no button.
    expect(screen.getAllByText("OGS Süd").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /OGS Süd/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /^08:00–13:00 Ihre Schule ?, von Ihrer Schule geblockt\. Blockung aufheben$/,
      }),
    ).toBeVisible();
  });

  it("blocks a free day and reloads the week", async () => {
    api.blockSpringer.mockResolvedValue(LENA.blocks[1]);
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Lena Springer am Mi 09\.09\. blocken/,
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Springer blocken",
    });
    fireEvent.change(within(dialog).getByLabelText(/Ende/), {
      target: { value: "14:00" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Blocken" }));
    expect(
      await screen.findByText(
        /Lena Springer ist am 09\.09\.2026 von 08:00 bis 14:00 Uhr/,
      ),
    ).toBeVisible();
    expect(api.blockSpringer).toHaveBeenCalledWith({
      recordId: "7",
      date: "2026-09-09",
      startTime: "08:00",
      endTime: "14:00",
    });
    expect(api.fetchSchoolPoolWeek).toHaveBeenCalledTimes(2);
  });

  it("names the clash when another school was faster", async () => {
    api.blockSpringer.mockRejectedValue(
      new ApiError("taken", 409, { code: "workforce.pool_block_taken" }),
    );
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Lena Springer am Mi 09\.09\. blocken/,
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Springer blocken",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Blocken" }));
    expect(
      await within(dialog).findByText(
        /Diese Person ist zu dieser Zeit schon geblockt/,
      ),
    ).toBeVisible();
  });

  it("lifts its own block after asking", async () => {
    api.liftSchoolBlock.mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", {
        name: /^08:00–13:00 Ihre Schule ?, von Ihrer Schule geblockt\. Blockung aufheben$/,
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Blockung aufheben?",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Aufheben" }));
    expect(
      await screen.findByText(
        /Die Blockung von Lena Springer am 11\.09\.2026 ist aufgehoben/,
      ),
    ).toBeVisible();
    expect(api.liftSchoolBlock).toHaveBeenCalledWith("41");
  });

  it("keeps the newer week when the answer for the older week comes late", async () => {
    let answerFirst: (week: PoolWeek) => void = () => undefined;
    api.fetchSchoolPoolWeek
      .mockImplementationOnce(
        () => new Promise<PoolWeek>((resolve) => (answerFirst = resolve)),
      )
      .mockResolvedValueOnce({
        ...WEEK,
        weekStart: "2026-09-14",
        springers: [{ ...LENA, blocks: [] }],
      });
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Nächste Woche" }),
    );
    expect(
      (await screen.findAllByText("Springer, Lena")).length,
    ).toBeGreaterThan(0);
    answerFirst(WEEK);
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Anker: die Zeile der Woche ab 14.09. bleibt stehen; ohne Schutz
    // stünde wieder das Ladegerüst da.
    expect(screen.getAllByText("Springer, Lena").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /von Ihrer Schule geblockt/ }),
    ).not.toBeInTheDocument();
  });

  it("says why there are no Springer when the Träger keeps no staff in moto", async () => {
    api.fetchSchoolPoolWeek.mockResolvedValue({
      ...WEEK,
      available: false,
      springers: [],
    });
    renderPage();
    expect(
      await screen.findByText("Ihr Träger führt sein Personal nicht in moto."),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Vorherige Woche" }),
    ).not.toBeInTheDocument();
  });
});
