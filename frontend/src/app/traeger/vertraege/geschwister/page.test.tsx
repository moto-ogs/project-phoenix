import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import type {
  ContractFamilies,
  ContractFamilyMember,
} from "~/lib/traeger-contract-families-api";
import { catalogText } from "~/test/error-catalog-text";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import TraegerContractFamiliesPage from "./page";

vi.unmock("swr");

const api = vi.hoisted(() => ({
  fetchContractFamilies: vi.fn(),
  joinContractFamily: vi.fn(),
  leaveContractFamily: vi.fn(),
}));
vi.mock("~/lib/traeger-contract-families-api", () => api);
vi.mock("next-auth/react", () => ({
  SessionProvider: ({ children }: { children: ReactNode }) => children,
  useSession: () => ({
    data: { user: { id: "A", scope: "org", orgId: "7" } },
    status: "authenticated",
  }),
}));
vi.mock("~/lib/auth-utils", () => ({ hasPermission: () => true }));
vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path.replace(/^\/traeger/, "") || "/",
}));
vi.mock("~/lib/traeger-api", () => ({
  fetchTraegerBuero: () =>
    Promise.resolve({
      members: [{ accountId: "8", email: "buero@sjr.example" }],
    }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/vertraege/geschwister",
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function contract(
  contractId: string,
  childFirstName: string,
  childLastName: string,
  familyContractId = contractId,
): ContractFamilyMember {
  return {
    contractId,
    familyContractId,
    schoolId: "1",
    schoolName: "OGS Ispringen",
    childFirstName,
    childLastName,
    childBirthDate: "2018-05-05",
    partyName: `Katrin ${childLastName}`,
  };
}

const apart: ContractFamilies = {
  version: "v1",
  contracts: [
    contract("3", "Finn", "Schulz"),
    contract("4", "Mila", "Schulz"),
    contract("7", "Ben", "Yilmaz"),
  ],
  events: [],
};

const joined: ContractFamilies = {
  version: "v2",
  contracts: [
    contract("3", "Finn", "Schulz"),
    contract("4", "Mila", "Schulz", "3"),
    contract("7", "Ben", "Yilmaz"),
  ],
  events: [
    {
      id: "1",
      action: "join_family",
      contractId: "4",
      familyContractId: "3",
      previousFamilyContractId: "4",
      childFirstName: "Mila",
      childLastName: "Schulz",
      accountId: "8",
      at: "2026-09-09T10:00:00Z",
    },
  ],
};

function renderPage(set: ContractFamilies) {
  api.fetchContractFamilies.mockReset().mockResolvedValue(set);
  render(
    <ToastProvider>
      <TraegerResourceTestProvider>
        <TraegerContractFamiliesPage />
      </TraegerResourceTestProvider>
    </ToastProvider>,
  );
}

describe("TraegerContractFamiliesPage", () => {
  it("joins two chosen families under the lead the office picks", async () => {
    renderPage(apart);
    expect(await screen.findByText("Finn Schulz")).toBeInTheDocument();
    expect(screen.getAllByText("Einzeln")).toHaveLength(3);

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Familie von Finn Schulz auswählen",
      }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Familie von Mila Schulz auswählen",
      }),
    );
    expect(
      screen.getByText("2 Familien ausgewählt, 2 Kinder"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Zusammenführen/ }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Wer führt die Familie?"),
    ).toBeInTheDocument();
    const lead = within(dialog).getAllByRole("radio");
    expect(lead).toHaveLength(2);
    expect(lead[0]).toBeChecked();
    fireEvent.click(lead[1] as HTMLElement);

    api.joinContractFamily.mockResolvedValue({
      ...joined,
      contracts: [
        contract("3", "Finn", "Schulz", "4"),
        contract("4", "Mila", "Schulz"),
        contract("7", "Ben", "Yilmaz"),
      ],
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Zusammenführen" }),
    );
    expect(
      await screen.findByText(
        "2 Kinder sind jetzt eine Familie. Der nächste Monatslauf zählt sie als Geschwister.",
      ),
    ).toBeInTheDocument();
    expect(api.joinContractFamily).toHaveBeenCalledWith({
      contractIds: ["3", "4"],
      familyContractId: "4",
      expectedVersion: "v1",
    });
    expect(await screen.findByText("2 Kinder zusammen")).toBeInTheDocument();
  });

  it("asks before it takes a child out of its family", async () => {
    renderPage(joined);
    expect(await screen.findByText("2 Kinder zusammen")).toBeInTheDocument();
    expect(
      await screen.findByText("Mila Schulz zur Familie von Finn Schulz"),
    ).toBeInTheDocument();
    expect(await screen.findByText("buero@sjr.example")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Aktionen für die Familie von Finn Schulz",
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Mila Schulz lösen/ }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        /Mila Schulz ist danach wieder eine eigene Familie/,
      ),
    ).toBeInTheDocument();
    api.leaveContractFamily.mockResolvedValue(apart);
    fireEvent.click(within(dialog).getByRole("button", { name: "Lösen" }));
    expect(
      await screen.findByText("Mila Schulz ist wieder eine eigene Familie."),
    ).toBeInTheDocument();
    expect(api.leaveContractFamily).toHaveBeenCalledWith("4", "v2");
  });

  it("shows the stored families when a colleague changed them since", async () => {
    renderPage(apart);
    await screen.findByText("Finn Schulz");
    api.fetchContractFamilies.mockResolvedValue(joined);
    api.joinContractFamily.mockRejectedValue(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Familie von Finn Schulz auswählen",
      }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Familie von Ben Yilmaz auswählen",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Zusammenführen/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Zusammenführen" }),
    );
    expect(
      await screen.findByText(
        catalogText("general.changed_since_read", "die Familie"),
      ),
    ).toBeInTheDocument();
    expect(await screen.findByText("2 Kinder zusammen")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says there is nothing to do when every family has an address", async () => {
    renderPage({ version: "v0", contracts: [], events: [] });
    expect(
      await screen.findByText("Alle Familien haben eine Mail-Adresse"),
    ).toBeInTheDocument();
  });
});
