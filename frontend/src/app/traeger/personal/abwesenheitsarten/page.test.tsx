import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import type {
  TraegerAbsenceType,
  TraegerAbsenceTypeList,
} from "~/lib/traeger-absence-api";

const api = vi.hoisted(() => ({
  fetchTraegerAbsenceTypes: vi.fn(),
  createTraegerAbsenceType: vi.fn(),
  updateTraegerAbsenceType: vi.fn(),
}));

vi.mock("~/lib/traeger-absence-api", () => api);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/personal/abwesenheitsarten",
  useSearchParams: () => new URLSearchParams(),
}));

import TraegerAbsenceTypesPage from "./page";

const REGENERATION: TraegerAbsenceType = {
  id: "7",
  name: "Regenerationstag",
  allowanceEnabled: true,
  standardDays: 2,
  carryoverUntil: null,
  requestable: true,
  isActive: true,
  schools: [
    {
      schoolId: "1",
      schoolName: "OGS Nord",
      carried: true,
      offered: true,
      schoolLimitDays: null,
    },
    {
      schoolId: "2",
      schoolName: "OGS Süd",
      carried: true,
      offered: true,
      schoolLimitDays: 1,
    },
    {
      schoolId: "3",
      schoolName: "OGS West",
      carried: false,
      offered: true,
      schoolLimitDays: null,
    },
  ],
};

const LIST: TraegerAbsenceTypeList = {
  released: true,
  schoolCount: 3,
  types: [REGENERATION],
};

function renderPage() {
  return render(
    <ToastProvider>
      <TraegerAbsenceTypesPage />
    </ToastProvider>,
  );
}

describe("TraegerAbsenceTypesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchTraegerAbsenceTypes.mockResolvedValue(LIST);
  });

  it("shows how every school carries a type of the Träger", async () => {
    renderPage();
    const card = (
      await screen.findByText("Regenerationstag", { selector: "h2" })
    ).closest("section");
    if (!card) throw new Error("card missing");
    expect(
      within(card).getByText(
        "2 Tage je Person und Jahr · Rest verfällt am 31.12. · Betreuungskräfte beantragen",
      ),
    ).toBeInTheDocument();
    expect(within(card).getByText("Angeboten")).toBeInTheDocument();
    expect(within(card).getByText("Höchstens 1 Tag")).toBeInTheDocument();
    expect(within(card).getByText("Noch nicht übernommen")).toBeInTheDocument();
  });

  it("creates a type with its Kontingent and refuses a missing name", async () => {
    api.createTraegerAbsenceType.mockResolvedValue({
      ...REGENERATION,
      id: "8",
      name: "Umwandlungstag",
    });
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Abwesenheitsart" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Name/), {
      target: { value: "" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Anlegen" }));
    expect(
      await within(dialog).findByText("Bitte geben Sie einen Namen ein."),
    ).toBeInTheDocument();
    expect(api.createTraegerAbsenceType).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/^Name/), {
      target: { value: "Umwandlungstag" },
    });
    fireEvent.change(within(dialog).getByLabelText(/^Tage je Jahr/), {
      target: { value: "3" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Anlegen" }));
    await vi.waitFor(() =>
      expect(api.createTraegerAbsenceType).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Umwandlungstag",
          allowanceEnabled: true,
          standardDays: 3,
          requestable: true,
        }),
      ),
    );
    expect(
      await screen.findByText(
        "Die Abwesenheitsart „Umwandlungstag“ ist angelegt. Alle Schulen sehen sie.",
      ),
    ).toBeInTheDocument();
  });

  it("explains that the moto team has to release Personal beim Träger first", async () => {
    api.fetchTraegerAbsenceTypes.mockResolvedValue({
      released: false,
      schoolCount: 3,
      types: [],
    });
    renderPage();
    expect(
      await screen.findByText(
        "Personal beim Träger ist noch nicht freigeschaltet.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Abwesenheitsart" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Abwesenheitsarten")).toBeInTheDocument();
  });
});
