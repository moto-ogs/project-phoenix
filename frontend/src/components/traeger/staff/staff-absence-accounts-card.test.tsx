import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import type { TraegerAbsenceAccount } from "~/lib/traeger-absence-api";
import { TEST_CLOCK_TODAY } from "~/test/clock";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";
import { useSWRConfig } from "~/lib/swr/testing";

vi.unmock("swr");

const api = vi.hoisted(() => ({
  fetchTraegerAbsenceAccounts: vi.fn(),
  setTraegerAbsenceAllowance: vi.fn(),
}));

vi.mock("~/lib/traeger-absence-api", () => api);
vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path.replace(/^\/traeger/, "") || "/",
}));

import { StaffAbsenceAccountsCard } from "./staff-absence-accounts-card";

// The card asks for the Kontingent of the current Berlin year.
const YEAR = Number(TEST_CLOCK_TODAY.slice(0, 4));

const ACCOUNT: TraegerAbsenceAccount = {
  absenceTypeId: "7",
  absenceTypeName: "Regenerationstag",
  year: YEAR,
  entitledDays: 3,
  individual: true,
  standardDays: 2,
  takenDays: 1,
  reservedDays: 1,
  remainingDays: 1,
  expiresOn: `${YEAR}-12-31`,
  expiredDays: 0,
  carriedIn: null,
  version: "claim-1",
  schools: [
    {
      schoolId: "1",
      schoolName: "OGS Nord",
      takenDays: 1,
      reservedDays: 0,
      limitDays: null,
      offered: true,
    },
    {
      schoolId: "2",
      schoolName: "OGS Süd",
      takenDays: 0,
      reservedDays: 1,
      limitDays: 1.5,
      offered: true,
    },
  ],
};

// Stands in for a live update: every read in the cache revalidates.
let revalidateAll: () => Promise<unknown> = () => Promise.resolve();
function CacheHandle() {
  const { mutate } = useSWRConfig();
  revalidateAll = () => mutate(() => true);
  return null;
}

function renderCard() {
  return render(
    <TraegerResourceTestProvider>
      <CacheHandle />
      <StaffAbsenceAccountsCard recordId="5" />
    </TraegerResourceTestProvider>,
  );
}

describe("StaffAbsenceAccountsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchTraegerAbsenceAccounts.mockResolvedValue([ACCOUNT]);
    api.setTraegerAbsenceAllowance.mockResolvedValue(undefined);
  });

  it("shows one Kontingent over all schools with each school's share", async () => {
    renderCard();
    const card = await screen.findByRole("region", {
      name: `Regenerationstag ${YEAR}`,
    });
    expect(within(card).getByText("für diese Person")).toBeInTheDocument();
    expect(within(card).getByText("OGS Nord")).toBeInTheDocument();
    expect(
      within(card).getByText(
        "0 Tage genommen · 1 Tag beantragt · hier höchstens 1,5 Tage",
      ),
    ).toBeInTheDocument();
    expect(api.fetchTraegerAbsenceAccounts).toHaveBeenCalledWith("5", YEAR);
  });

  it("refuses a claim below the booked days and saves a valid one with its reason", async () => {
    renderCard();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Anspruch ändern: Regenerationstag",
      }),
    );
    const days = screen.getByLabelText(`Anspruch ${YEAR} in Tagen`);
    fireEvent.change(days, { target: { value: "1,5" } });
    fireEvent.change(screen.getByLabelText("Begründung"), {
      target: { value: "Vertrag" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(
      await screen.findByText(
        "Mindestens 2 Tage. So viele sind an allen Schulen schon eingetragen oder beantragt.",
      ),
    ).toBeInTheDocument();
    expect(api.setTraegerAbsenceAllowance).not.toHaveBeenCalled();

    fireEvent.change(days, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await vi.waitFor(() =>
      expect(api.setTraegerAbsenceAllowance).toHaveBeenCalledWith("5", "7", {
        year: YEAR,
        entitledDays: 4,
        reason: "Vertrag",
        expectedVersion: "claim-1",
      }),
    );
  });

  it("shows the stored claim without a retry when it changed since the read", async () => {
    api.setTraegerAbsenceAllowance.mockRejectedValueOnce(
      new ApiError("changed since it was read", 409, {
        code: "general.changed_since_read",
      }),
    );
    renderCard();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Anspruch ändern: Regenerationstag",
      }),
    );
    api.fetchTraegerAbsenceAccounts.mockResolvedValue([
      { ...ACCOUNT, entitledDays: 6, version: "claim-2" },
    ]);
    fireEvent.change(screen.getByLabelText(`Anspruch ${YEAR} in Tagen`), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByLabelText("Begründung"), {
      target: { value: "Vertrag" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(
        catalogText("general.changed_since_read", "die Änderung am Anspruch"),
      ),
    ).toBeInTheDocument();
    // The form shows the claim a colleague stored and saves against it.
    await vi.waitFor(() =>
      expect(screen.getByLabelText(`Anspruch ${YEAR} in Tagen`)).toHaveValue(
        "6",
      ),
    );
    expect(
      screen.queryByRole("button", { name: "Wiederholen" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await vi.waitFor(() =>
      expect(api.setTraegerAbsenceAllowance).toHaveBeenLastCalledWith(
        "5",
        "7",
        expect.objectContaining({
          entitledDays: 6,
          expectedVersion: "claim-2",
        }),
      ),
    );
  });

  // ADR 0311 rule 6: a failed read of the stored claim after a refusal is
  // a load error, and the refused version is not sent again.
  it("names a failed read of the stored claim after a refusal", async () => {
    api.setTraegerAbsenceAllowance.mockRejectedValueOnce(
      new ApiError("changed since it was read", 409, {
        code: "general.changed_since_read",
      }),
    );
    renderCard();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Anspruch ändern: Regenerationstag",
      }),
    );
    api.fetchTraegerAbsenceAccounts.mockRejectedValue(
      new ApiError("down", 503, { code: "general.unavailable" }),
    );
    fireEvent.change(screen.getByLabelText(`Anspruch ${YEAR} in Tagen`), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByLabelText("Begründung"), {
      target: { value: "Vertrag" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(/Der neue Stand konnte nicht geladen werden/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Du siehst jetzt den neuen Stand/),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(api.setTraegerAbsenceAllowance).toHaveBeenCalledTimes(1);
  });

  // ADR 0311 rule 6: the claim is saved, its read failed; the card says so
  // over the old figures and reads again on „Wiederholen“.
  it("names a failed read after a saved claim over the shown figures", async () => {
    api.setTraegerAbsenceAllowance.mockResolvedValueOnce(undefined);
    renderCard();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Anspruch ändern: Regenerationstag",
      }),
    );
    api.fetchTraegerAbsenceAccounts.mockRejectedValue(
      new ApiError("down", 503, { code: "general.unavailable" }),
    );
    fireEvent.change(screen.getByLabelText(`Anspruch ${YEAR} in Tagen`), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByLabelText("Begründung"), {
      target: { value: "Vertrag" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(/Deine Änderung ist gespeichert/),
    ).toBeInTheDocument();
    api.fetchTraegerAbsenceAccounts.mockResolvedValue([
      { ...ACCOUNT, entitledDays: 4, remainingDays: 2, version: "claim-2" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    await vi.waitFor(() =>
      expect(
        screen.queryByText(/Deine Änderung ist gespeichert/),
      ).not.toBeInTheDocument(),
    );
    expect(api.setTraegerAbsenceAllowance).toHaveBeenCalledTimes(1);
  });

  it("keeps typed days and their version when a colleague's claim arrives", async () => {
    renderCard();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Anspruch ändern: Regenerationstag",
      }),
    );
    fireEvent.change(screen.getByLabelText(`Anspruch ${YEAR} in Tagen`), {
      target: { value: "4" },
    });
    const reads = api.fetchTraegerAbsenceAccounts.mock.calls.length;
    api.fetchTraegerAbsenceAccounts.mockResolvedValue([
      { ...ACCOUNT, entitledDays: 6, version: "claim-2" },
    ]);
    await act(revalidateAll);
    expect(api.fetchTraegerAbsenceAccounts.mock.calls.length).toBeGreaterThan(
      reads,
    );

    // The typed 4 stays; the save carries the version it was typed over, so
    // the server refuses instead of storing 4 over the colleague's 6 unseen.
    expect(screen.getByLabelText(`Anspruch ${YEAR} in Tagen`)).toHaveValue("4");
    fireEvent.change(screen.getByLabelText("Begründung"), {
      target: { value: "Vertrag" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await vi.waitFor(() =>
      expect(api.setTraegerAbsenceAllowance).toHaveBeenCalledWith(
        "5",
        "7",
        expect.objectContaining({
          entitledDays: 4,
          expectedVersion: "claim-1",
        }),
      ),
    );
  });

  it("points to the Abwesenheitsarten when the Träger has none with a Kontingent", async () => {
    api.fetchTraegerAbsenceAccounts.mockResolvedValue([]);
    renderCard();
    expect(
      await screen.findByText("Keine Abwesenheitsart mit Kontingent."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Zu den Abwesenheitsarten" }),
    ).toHaveAttribute("href", "/personal/abwesenheitsarten");
  });
});

it("performs a new audited read on immediate reopening", async () => {
  api.fetchTraegerAbsenceAccounts.mockReset().mockResolvedValue([ACCOUNT]);
  const view = render(<StaffAbsenceAccountsCard recordId="5" />, {
    wrapper: TraegerResourceTestProvider,
  });
  expect(
    await screen.findByRole("region", { name: `Regenerationstag ${YEAR}` }),
  ).toBeVisible();
  expect(api.fetchTraegerAbsenceAccounts).toHaveBeenCalledTimes(1);
  view.rerender(<div>away</div>);
  view.rerender(<StaffAbsenceAccountsCard recordId="5" />);
  await vi.waitFor(() =>
    expect(api.fetchTraegerAbsenceAccounts).toHaveBeenCalledTimes(2),
  );
});
