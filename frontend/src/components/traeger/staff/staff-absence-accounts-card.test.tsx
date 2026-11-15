import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import type { TraegerAbsenceAccount } from "~/lib/traeger-absence-api";

const api = vi.hoisted(() => ({
  fetchTraegerAbsenceAccounts: vi.fn(),
  setTraegerAbsenceAllowance: vi.fn(),
}));

vi.mock("~/lib/traeger-absence-api", () => api);
vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path.replace(/^\/traeger/, "") || "/",
}));

import { StaffAbsenceAccountsCard } from "./staff-absence-accounts-card";

const ACCOUNT: TraegerAbsenceAccount = {
  absenceTypeId: "7",
  absenceTypeName: "Regenerationstag",
  year: 2026,
  entitledDays: 3,
  individual: true,
  standardDays: 2,
  takenDays: 1,
  reservedDays: 1,
  remainingDays: 1,
  expiresOn: "2026-12-31",
  expiredDays: 0,
  carriedIn: null,
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

function renderCard() {
  return render(
    <ToastProvider>
      <StaffAbsenceAccountsCard recordId="5" />
    </ToastProvider>,
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
      name: "Regenerationstag 2026",
    });
    expect(within(card).getByText("für diese Person")).toBeInTheDocument();
    expect(within(card).getByText("OGS Nord")).toBeInTheDocument();
    expect(
      within(card).getByText(
        "0 Tage genommen · 1 Tag beantragt · hier höchstens 1,5 Tage",
      ),
    ).toBeInTheDocument();
    expect(api.fetchTraegerAbsenceAccounts).toHaveBeenCalledWith("5", 2026);
  });

  it("refuses a claim below the booked days and saves a valid one with its reason", async () => {
    renderCard();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Anspruch ändern: Regenerationstag",
      }),
    );
    const days = screen.getByLabelText("Anspruch 2026 in Tagen");
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
        year: 2026,
        entitledDays: 4,
        reason: "Vertrag",
      }),
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
