import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "~/contexts/ToastContext";
import { MODULE_KEYS } from "~/lib/modules";
import type { TenantInfo } from "~/lib/tenant-api";
import { useBookedModules, useTenantSafe } from "~/lib/tenant-context";

const useSWRAuth = vi.hoisted(() => vi.fn());
const selection = vi.hoisted(() => ({ current: "" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/database/absence-types",
  useSearchParams: () => new URLSearchParams(selection.current),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

vi.mock("~/lib/swr", () => ({
  useSWRAuth,
  useTenantMutate: () => vi.fn(),
  revalidateOrThrow: (read: { data: unknown }) => Promise.resolve(read.data),
}));

import { absenceTypeService, type AbsenceType } from "~/lib/absence-type-api";
import AbsenceTypesPage from "./page-content";

const FROM_TRAEGER: AbsenceType = {
  id: "3",
  name: "Umwandlungstag",
  baseType: "other",
  isActive: true,
  allowanceEnabled: true,
  carryoverUntil: "03-31",
  requestable: false,
  keptByTraeger: true,
  offered: true,
  schoolLimitDays: 2,
  version: "v1",
};

const TENANT = { tenantId: "1", slug: "demo" } as TenantInfo;

describe("AbsenceTypesPage", () => {
  beforeEach(() => {
    useSWRAuth.mockClear();
    vi.mocked(useTenantSafe).mockReturnValue({
      tenantSlug: "demo",
      tenant: TENANT,
      routingMode: "subdomain",
    });
    vi.mocked(useBookedModules).mockReturnValue(MODULE_KEYS);
  });

  it("keeps absence-type data hooks closed when the module is not booked", () => {
    vi.mocked(useBookedModules).mockReturnValue(
      MODULE_KEYS.filter((key) => key !== "zeiterfassung"),
    );

    render(<AbsenceTypesPage />);

    // Anker: Der gesperrte Seitenzustand ist gerendert.
    expect(screen.getByText("Zeiterfassung ist nicht gebucht")).toBeVisible();
    expect(useSWRAuth).not.toHaveBeenCalled();
  });

  it("shows a type of the Träger read-only with the school's own limit (#4710)", () => {
    selection.current = "eintrag=3";
    useSWRAuth.mockReturnValue({
      data: [FROM_TRAEGER],
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    });

    render(
      <ToastProvider>
        <AbsenceTypesPage />
      </ToastProvider>,
    );

    expect(
      screen.getAllByText("Vom Träger · hier höchstens 2 Tage").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Je Person über alle Schulen")).toBeVisible();
    expect(
      screen.getByLabelText(
        "Höchstens Tage je Person und Jahr an dieser Schule",
      ),
    ).toHaveValue(2);
    expect(screen.queryByLabelText(/^Name/)).not.toBeInTheDocument();
  });

  // ADR 0311: das Speichern schickt den Stand der Art, aus dem das Formular
  // stammt.
  it("saves the school's limit over the version of the type it shows", async () => {
    selection.current = "eintrag=3";
    useSWRAuth.mockReturnValue({
      data: [FROM_TRAEGER],
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    });
    const update = vi
      .spyOn(absenceTypeService, "updateAbsenceType")
      .mockResolvedValue(FROM_TRAEGER);

    render(
      <ToastProvider>
        <AbsenceTypesPage />
      </ToastProvider>,
    );
    fireEvent.change(
      screen.getByLabelText(
        "Höchstens Tage je Person und Jahr an dieser Schule",
      ),
      { target: { value: "3" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("3", "v1", { schoolLimitDays: 3 }),
    );
    update.mockRestore();
  });
});
