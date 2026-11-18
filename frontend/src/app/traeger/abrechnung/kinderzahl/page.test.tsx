import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import type {
  FamilyChildren,
  FamilyChildrenSet,
} from "~/lib/traeger-family-children-api";
import { TEST_CLOCK_TODAY } from "~/test/clock";
import TraegerKinderzahlPage from "./page";

vi.unmock("swr");

const { fetchFamilyChildren, confirmFamilyChildren, removeFamilyChildren } =
  vi.hoisted(() => ({
    fetchFamilyChildren: vi.fn(),
    confirmFamilyChildren: vi.fn(),
    removeFamilyChildren: vi.fn(),
  }));
vi.mock("~/lib/traeger-family-children-api", () => ({
  fetchFamilyChildren,
  confirmFamilyChildren,
  removeFamilyChildren,
}));
vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path.replace(/^\/traeger/, "") || "/",
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/abrechnung/kinderzahl",
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const stated: FamilyChildren = {
  contractId: "31",
  recipientFirstName: "Eva",
  recipientLastName: "Beispiel",
  recipientEmail: "eva@example.org",
  children: [
    {
      contractId: "31",
      schoolName: "OGS Birkenfeld",
      childFirstName: "Mia",
      childLastName: "Beispiel",
    },
  ],
  count: {
    id: "5",
    contractId: "31",
    statedChildren: 3,
    statedAt: "2026-09-05T08:00:00Z",
    confirmedChildren: null,
    validFrom: null,
    validUntil: null,
    confirmedAt: null,
  },
  status: "stated",
};
const confirmed: FamilyChildren = {
  contractId: "32",
  recipientFirstName: "Jonas",
  recipientLastName: "Muster",
  recipientEmail: "jonas@example.org",
  children: [
    {
      contractId: "32",
      schoolName: "OGS Ispringen",
      childFirstName: "Lea",
      childLastName: "Muster",
    },
  ],
  count: {
    id: "6",
    contractId: "32",
    statedChildren: null,
    statedAt: null,
    confirmedChildren: 2,
    validFrom: "2026-08-01",
    validUntil: null,
    confirmedAt: "2026-08-02T08:00:00Z",
  },
  status: "confirmed",
};
const data: FamilyChildrenSet = {
  families: [stated, confirmed],
  rules: [{ id: "9", name: "Geschwister Birkenfeld" }],
};

function renderPage(set: FamilyChildrenSet = data) {
  fetchFamilyChildren.mockResolvedValue(set);
  render(
    <TraegerResourceTestProvider>
      <TraegerKinderzahlPage />
    </TraegerResourceTestProvider>,
  );
}

describe("TraegerKinderzahlPage", () => {
  it("lists only the parents' new statement under „Zu prüfen“ and confirms it", async () => {
    renderPage();
    const checks = (
      await screen.findByRole("heading", { name: "Zu prüfen" })
    ).closest("section") as HTMLElement;
    expect(within(checks).getByText("Eva Beispiel")).toBeInTheDocument();
    expect(within(checks).queryByText("Jonas Muster")).not.toBeInTheDocument();
    expect(
      within(checks).getByText(/Eltern geben 3 Kinder an/),
    ).toBeInTheDocument();

    confirmFamilyChildren.mockResolvedValue({
      ...data,
      families: [{ ...stated, status: "confirmed" }, confirmed],
    });
    fireEvent.click(
      within(checks).getByRole("button", {
        name: "Kinderzahl von Eva Beispiel prüfen",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/Kinder in der Familie/)).toHaveValue(
      "3",
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Kinderzahl bestätigen" }),
    );
    await vi.waitFor(() =>
      expect(confirmFamilyChildren).toHaveBeenCalledWith({
        contractId: "31",
        children: 3,
        // Die bestätigte Zahl gilt ab dem Ersten des laufenden Monats.
        validFrom: `${TEST_CLOCK_TODAY.slice(0, 8)}01`,
        validUntil: null,
      }),
    );
  });

  it("lists a contract without a mail address as a family of its own", async () => {
    const imported: FamilyChildren = {
      contractId: "77",
      recipientFirstName: "",
      recipientLastName: "",
      recipientEmail: "",
      children: [
        {
          contractId: "77",
          schoolName: "OGS Birkenfeld",
          childFirstName: "Noah",
          childLastName: "Zeller",
        },
      ],
      count: null,
      status: "missing",
    };
    renderPage({ ...data, families: [imported] });
    expect(
      await screen.findByText("Familie von Noah Zeller"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Vertrag Nr. 77 · ohne E-Mail"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Aus Datei nachtragen" }),
    ).toHaveAttribute("href", "/abrechnung/kinderzahl/import");

    confirmFamilyChildren.mockResolvedValue({ ...data, families: [imported] });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Kinderzahl: Familie von Noah Zeller",
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Kinderzahl bestätigen/ }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Kinderzahl bestätigen" }),
    );
    await vi.waitFor(() =>
      expect(confirmFamilyChildren).toHaveBeenCalledWith(
        expect.objectContaining({ contractId: "77", children: 1 }),
      ),
    );
  });

  it("asks the office when the contracts of a family bring different numbers", async () => {
    renderPage({
      ...data,
      families: [{ ...stated, count: null, status: "differing" }],
    });
    const checks = (
      await screen.findByRole("heading", { name: "Zu prüfen" })
    ).closest("section") as HTMLElement;
    expect(
      within(checks).getByText(/nennen verschiedene Kinderzahlen/),
    ).toBeInTheDocument();
    expect(
      within(checks).getByText("Verschiedene Angaben"),
    ).toBeInTheDocument();
    removeFamilyChildren.mockResolvedValue({ ...data, families: [] });
    fireEvent.click(
      screen.getByRole("button", { name: "Kinderzahl: Eva Beispiel" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Kinderzahl entfernen/ }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Ja, entfernen" }),
    );
    fireEvent.click(
      await within(dialog).findByRole("button", { name: "Entfernen" }),
    );
    await vi.waitFor(() =>
      expect(removeFamilyChildren).toHaveBeenCalledWith(stated.contractId),
    );
  });

  it("shows a parental correction alongside the carried confirmation in the modal", async () => {
    renderPage({
      ...data,
      families: [
        {
          ...stated,
          status: "changed",
          count: {
            ...stated.count!,
            confirmedChildren: 2,
            confirmedAt: "2026-09-01T08:00:00Z",
            validFrom: "2026-09-01",
          },
        },
      ],
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Kinderzahl von Eva Beispiel prüfen",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Bisher bestätigt")).toBeInTheDocument();
    expect(within(dialog).getByText("2 Kinder")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Kinder in der Familie/)).toHaveValue(
      "3",
    );
  });

  it("says when no sibling rule counts the number yet", async () => {
    renderPage({ ...data, rules: [] });
    expect(
      await screen.findByText(/Noch keine Geschwisterregel zählt diese Zahl/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Zu den Ermäßigungen" }),
    ).toHaveAttribute("href", "/abrechnung/ermaessigungen");
  });
});
