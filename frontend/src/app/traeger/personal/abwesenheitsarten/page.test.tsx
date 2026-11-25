import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import type {
  TraegerAbsenceType,
  TraegerAbsenceTypeList,
} from "~/lib/traeger-absence-api";

vi.unmock("swr");

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

import TraegerAbsenceTypesPage from "./page-content";

const REGENERATION: TraegerAbsenceType = {
  id: "7",
  name: "Regenerationstag",
  allowanceEnabled: true,
  standardDays: 2,
  carryoverUntil: null,
  requestable: true,
  isActive: true,
  version: "regeneration-v1",
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
    <TraegerResourceTestProvider>
      <TraegerAbsenceTypesPage />
    </TraegerResourceTestProvider>,
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
      await screen.findByRole("button", { name: "Abwesenheitsart anlegen" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Name/), {
      target: { value: "" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Anlegen" }));
    expect(
      await within(dialog).findByText("Bitte gib einen Namen ein."),
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
    // #7415: die Bauart „Funktion nicht eingeschaltet“ mit dem Satz der Seite.
    expect(
      await screen.findByText("Diese Funktion ist nicht eingeschaltet"),
    ).toBeVisible();
    expect(
      screen.getByText(
        /Bis zur Freischaltung legt jede Schule ihre Abwesenheitsarten selbst an\. Das moto-Team schaltet/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Abwesenheitsart anlegen" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Abwesenheitsarten")).toBeInTheDocument();
  });

  // #7304: the type cards sit in one grid, so the last one keeps its height.
  it("puts the type cards into one grid", async () => {
    api.fetchTraegerAbsenceTypes.mockResolvedValue({
      ...LIST,
      types: [REGENERATION, { ...REGENERATION, id: "8", name: "Bildungstag" }],
    });
    renderPage();
    await screen.findByText("Regenerationstag", { selector: "h2" });
    const cards = ["Regenerationstag", "Bildungstag"].map((name) =>
      screen.getByText(name, { selector: "h2" }).closest("section"),
    );
    const grid = cards[0]?.parentElement;
    expect(grid).toHaveClass("grid");
    for (const card of cards) expect(card?.parentElement).toBe(grid);
  });

  // ADR 0311: an edit and the switch rest on the type as the card read it.
  // A colleague's change since is refused; the card shows the stored type.
  const changed = () =>
    new ApiError("changed", 409, { code: "general.changed_since_read" });
  const storedList: TraegerAbsenceTypeList = {
    ...LIST,
    types: [{ ...REGENERATION, standardDays: 4, version: "regeneration-v2" }],
  };
  const typeCard = async () => {
    const card = (
      await screen.findByText("Regenerationstag", { selector: "h2" })
    ).closest("section");
    if (!card) throw new Error("card missing");
    return card;
  };

  it("keeps the form open on the stored type after a refusal", async () => {
    api.updateTraegerAbsenceType.mockRejectedValueOnce(changed());
    renderPage();
    const card = await typeCard();
    fireEvent.click(within(card).getByRole("button", { name: /Bearbeiten/ }));
    fireEvent.change(within(card).getByLabelText(/^Tage je Jahr/), {
      target: { value: "3" },
    });
    api.fetchTraegerAbsenceTypes.mockResolvedValue(storedList);
    fireEvent.click(within(card).getByRole("button", { name: "Speichern" }));

    expect(
      await within(card).findByText(
        catalogText("general.changed_since_read", "die Abwesenheitsart"),
      ),
    ).toBeInTheDocument();
    expect(api.updateTraegerAbsenceType.mock.calls.at(-1)?.[2]).toBe(
      "regeneration-v1",
    );
    await vi.waitFor(() =>
      expect(within(card).getByLabelText(/^Tage je Jahr/)).toHaveValue(4),
    );

    api.updateTraegerAbsenceType.mockResolvedValue(storedList.types[0]);
    fireEvent.change(within(card).getByLabelText(/^Tage je Jahr/), {
      target: { value: "5" },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Speichern" }));
    await vi.waitFor(() =>
      expect(api.updateTraegerAbsenceType.mock.calls.at(-1)?.[2]).toBe(
        "regeneration-v2",
      ),
    );
  });

  it("switches a type off over the version the card shows and reads it after a refusal", async () => {
    api.updateTraegerAbsenceType.mockRejectedValueOnce(changed());
    renderPage();
    const card = await typeCard();
    api.fetchTraegerAbsenceTypes.mockResolvedValue(storedList);
    fireEvent.click(
      within(card).getByRole("button", {
        name: "Weitere Aktionen zu Regenerationstag",
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Ausschalten/ }),
    );
    expect(
      await screen.findByText(
        catalogText("general.changed_since_read", "die Abwesenheitsart"),
      ),
    ).toBeInTheDocument();
    expect(api.updateTraegerAbsenceType).toHaveBeenLastCalledWith(
      "7",
      expect.objectContaining({ isActive: false, standardDays: 2 }),
      "regeneration-v1",
    );
    expect(
      await within(card).findByText(/4 Tage je Person und Jahr/),
    ).toBeInTheDocument();
  });
});
