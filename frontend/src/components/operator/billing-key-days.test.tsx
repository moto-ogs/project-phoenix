/**
 * Own key days of Träger and schools on the operator billing page (#7301):
 * the list, setting a day for a school, the warning for a day already
 * reached this month, resetting and a refused save.
 */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
// eslint-disable-next-line no-restricted-imports -- operator pages are not tenant-scoped
import { SWRConfig } from "~/lib/swr/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import type {
  BillingKeyDay,
  BillingKeyDayOverride,
} from "~/lib/operator/billing-api";
import { setTestClock } from "~/test/clock";
import { useState } from "react";

const { mockSet, mockReset, mockOrganizations, mockSchools, mockToastSuccess } =
  vi.hoisted(() => ({
    mockSet: vi.fn(),
    mockReset: vi.fn(),
    mockOrganizations: vi.fn(),
    mockSchools: vi.fn(),
    mockToastSuccess: vi.fn(),
  }));

vi.unmock("swr");

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { id: "operator-1", scope: "operator" } },
  }),
}));

vi.mock("~/contexts/ToastContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/contexts/ToastContext")>()),
  useToast: () => ({ success: mockToastSuccess, error: vi.fn() }),
}));

vi.mock("~/lib/operator/billing-api", async () => {
  const actual = await vi.importActual<
    typeof import("~/lib/operator/billing-api")
  >("~/lib/operator/billing-api");
  return {
    ...actual,
    operatorBillingService: {
      setKeyDayOverride: mockSet,
      resetKeyDayOverride: mockReset,
    },
  };
});

vi.mock("~/lib/operator/provisioning-api", () => ({
  operatorProvisioningService: {
    listOrganizations: mockOrganizations,
    listSchools: mockSchools,
  },
}));

import { BillingKeyDays } from "./billing-key-days";

const traegerNord: BillingKeyDayOverride = {
  scope: "organization",
  id: "4",
  organizationId: "4",
  name: "Träger Nord",
  organizationName: "",
  keyDay: 5,
  nextKeyDate: "2026-12-05",
  updatedAt: "2026-11-01T08:00:00Z",
};

const amBach: BillingKeyDayOverride = {
  scope: "school",
  id: "9",
  organizationId: "4",
  name: "OGS Am Bach",
  organizationName: "Träger Nord",
  keyDay: 20,
  nextKeyDate: "2026-11-20",
  updatedAt: "2026-11-01T08:00:00Z",
};

const NOTHING_CAPTURED: ReadonlySet<string> = new Set();

/** The page around the card: it keeps the key day the writes answer. */
function Harness({
  initial,
  captured = NOTHING_CAPTURED,
}: Readonly<{
  initial: BillingKeyDayOverride[];
  captured?: ReadonlySet<string>;
}>) {
  const [keyDay, setKeyDay] = useState<BillingKeyDay>({
    keyDay: 15,
    nextKeyDate: "2026-11-15",
    updatedAt: "2026-11-01T08:00:00Z",
    overrides: initial,
  });
  return (
    <BillingKeyDays
      keyDay={keyDay}
      loading={false}
      loadError={null}
      capturedThisMonth={captured}
      onChanged={setKeyDay}
    />
  );
}

function renderOverrides(
  initial: BillingKeyDayOverride[],
  captured?: Set<string>,
) {
  return render(
    <ToastProvider>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <Harness initial={initial} captured={captured} />
      </SWRConfig>
    </ToastProvider>,
  );
}

function keyDayWith(overrides: BillingKeyDayOverride[]): BillingKeyDay {
  return {
    keyDay: 15,
    nextKeyDate: "2026-11-15",
    updatedAt: "2026-11-01T08:00:00Z",
    overrides,
  };
}

function openMenuOf(name: string) {
  fireEvent.click(screen.getByRole("button", { name: `Aktionen für ${name}` }));
}

/** Opens a kit select by its label and picks an option. */
async function choose(label: string, option: string) {
  const select = screen.getByRole("combobox", { name: new RegExp(label) });
  // The list of schools or Träger loads when the dialog opens.
  await waitFor(() => expect(select).toBeEnabled());
  fireEvent.click(select);
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

describe("BillingKeyDayOverrides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTestClock("2026-11-10T10:00:00+01:00");
    mockOrganizations.mockResolvedValue([
      { id: "4", name: "Träger Nord", deletedAt: null },
      { id: "6", name: "Träger Süd", deletedAt: null },
    ]);
    mockSchools.mockResolvedValue([
      { id: "9", organizationId: "4", name: "OGS Am Bach", deletedAt: null },
      { id: "10", organizationId: "6", name: "OGS Lindenweg", deletedAt: null },
    ]);
  });

  it("lists each own day with what it replaces and its next key date", async () => {
    renderOverrides([traegerNord, amBach]);

    expect(await screen.findByText("Träger Nord")).toBeInTheDocument();
    expect(
      screen.getByText("Träger, für seine Schulen ohne eigenen Stichtag"),
    ).toBeInTheDocument();
    expect(screen.getByText("Schule von Träger Nord")).toBeInTheDocument();
    expect(screen.getByText("Jeden Monat am 20.")).toBeInTheDocument();
    expect(screen.getByText("nächster am 20.11.2026")).toBeInTheDocument();
  });

  it("says that every school counts on the standard when none has its own day", async () => {
    renderOverrides([]);

    // The standard is the only row and covers every school.
    expect(await screen.findByText("Standard")).toBeInTheDocument();
    expect(screen.getByText("Für alle Schulen")).toBeInTheDocument();
    expect(screen.getByText("Jeden Monat am 15.")).toBeInTheDocument();
  });

  it("gives a school its own day and confirms the next key date", async () => {
    const saved = {
      ...amBach,
      id: "10",
      name: "OGS Lindenweg",
      organizationName: "Träger Süd",
    };
    mockSet.mockResolvedValue(keyDayWith([traegerNord, saved]));
    renderOverrides([traegerNord]);
    await screen.findByText("Träger Nord");

    fireEvent.click(
      screen.getByRole("button", { name: "Eigenen Stichtag festlegen" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Schule" }));
    await choose("Schule", "OGS Lindenweg (Träger Süd)");
    await choose("Tag im Monat", "20.");

    expect(
      within(dialog).getByText(
        "Nächster Stichtag von OGS Lindenweg: 20.11.2026. Schon erfasste Monate bleiben, wie sie sind.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Stichtag festlegen" }),
    );

    await waitFor(() =>
      expect(mockSet).toHaveBeenCalledWith("school", "10", 20),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "OGS Lindenweg zählt ab jetzt am 20. Nächster Stichtag: 20.11.2026.",
    );
    expect(await screen.findByText("OGS Lindenweg")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("warns that a day already reached this month skips the month", async () => {
    renderOverrides([traegerNord]);
    await screen.findByText("Träger Nord");

    openMenuOf("Träger Nord");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Tag ändern/ }),
    );
    const dialog = await screen.findByRole("dialog");
    await choose("Tag im Monat", "8.");

    expect(
      within(dialog).getByText(
        "Der 8. ist im November 2026 schon vorbei. OGS Am Bach hat noch keine Zahlen für November 2026 und bekommt für diesen Monat keine mehr. Nächster Stichtag: 08.12.2026.",
      ),
    ).toBeInTheDocument();
  });

  it("hands a school back to its Träger's day", async () => {
    mockReset.mockResolvedValue(keyDayWith([traegerNord]));
    renderOverrides([traegerNord, amBach]);
    await screen.findByText("OGS Am Bach");

    openMenuOf("OGS Am Bach");
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: /Eigenen Stichtag aufheben/,
      }),
    );
    const confirm = await screen.findByRole("dialog");
    expect(
      within(confirm).getByText(
        "OGS Am Bach zählt dann wieder am 5., dem Tag von Träger Nord. Schon erfasste Monate bleiben, wie sie sind.",
      ),
    ).toBeInTheDocument();
    expect(mockReset).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Aufheben" }));

    await waitFor(() => expect(mockReset).toHaveBeenCalledWith("school", "9"));
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "OGS Am Bach zählt wieder am Stichtag von Träger Nord.",
    );
    await waitFor(() => expect(screen.queryByText("OGS Am Bach")).toBeNull());
  });

  it("keeps the dialog open with the reason when the save is refused", async () => {
    mockSet.mockRejectedValue(
      new ApiError("Organization not found", 404, {
        code: "provisioning.organization_not_found",
      }),
    );
    renderOverrides([traegerNord]);
    await screen.findByText("Träger Nord");

    openMenuOf("Träger Nord");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Tag ändern/ }),
    );
    const dialog = await screen.findByRole("dialog");
    await choose("Tag im Monat", "20.");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Stichtag festlegen" }),
    );

    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("ends a sentence once after a Träger name with a period", async () => {
    const vereinsSchule = {
      ...amBach,
      organizationName: "Ganztag Nord e. V.",
    };
    mockReset.mockResolvedValue(keyDayWith([]));
    renderOverrides([vereinsSchule]);
    await screen.findByText("OGS Am Bach");

    openMenuOf("OGS Am Bach");
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: /Eigenen Stichtag aufheben/,
      }),
    );
    const confirm = await screen.findByRole("dialog");
    expect(
      within(confirm).getByText(
        "OGS Am Bach zählt dann wieder am 15., dem Standard. Schon erfasste Monate bleiben, wie sie sind.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Aufheben" }));

    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith(
        "OGS Am Bach zählt wieder am Stichtag von Ganztag Nord e. V.",
      ),
    );
  });

  it("says the month stays when every reached school already has its figures", async () => {
    renderOverrides([traegerNord], new Set(["9"]));
    await screen.findByText("Träger Nord");

    openMenuOf("Träger Nord");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Tag ändern/ }),
    );
    const dialog = await screen.findByRole("dialog");
    await choose("Tag im Monat", "8.");

    expect(
      await within(dialog).findByText(
        "Der 8. ist im November 2026 schon vorbei. Die Zahlen für November 2026 stehen schon und bleiben, wie sie sind. Nächster Stichtag: 08.12.2026.",
      ),
    ).toBeInTheDocument();
  });

  it("finds a school's Träger by ID, not by a name another Träger shares", async () => {
    // A second Träger is also called „Träger Nord“; only ID 4 has its own day.
    const namesake = { ...amBach, organizationId: "6" };
    renderOverrides([traegerNord, namesake]);
    await screen.findByText("OGS Am Bach");

    openMenuOf("OGS Am Bach");
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: /Eigenen Stichtag aufheben/,
      }),
    );
    expect(
      await within(await screen.findByRole("dialog")).findByText(
        "OGS Am Bach zählt dann wieder am 15., dem Standard. Schon erfasste Monate bleiben, wie sie sind.",
      ),
    ).toBeInTheDocument();
  });

  it("warns generically when the school list fails, never says the month stays", async () => {
    mockSchools.mockRejectedValue(new ApiError("boom", 503));
    renderOverrides([traegerNord], new Set(["9"]));
    await screen.findByText("Träger Nord");

    openMenuOf("Träger Nord");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Tag ändern/ }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("combobox", { name: /Tag im Monat/ }),
    );
    fireEvent.click(await screen.findByRole("option", { name: "8." }));

    expect(
      await within(dialog).findByText(
        "Der 8. ist im November 2026 schon vorbei. Schulen ohne Zahlen bekommen für diesen Monat keine mehr. Nächster Stichtag: 08.12.2026.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/stehen schon/)).toBeNull();
  });
});
