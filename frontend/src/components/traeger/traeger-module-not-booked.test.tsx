import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TenantPage } from "~/components/ui/tenant-page";

const { mockUseSession, mockPathname, mockReplace } = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
  mockPathname: vi.fn(() => "/traeger/abrechnung"),
  mockReplace: vi.fn(),
}));
vi.mock("next-auth/react", () => ({ useSession: () => mockUseSession() }));
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({ replace: mockReplace }),
}));
vi.mock("~/lib/traeger-url", () => ({ traegerPath: (path: string) => path }));

import { TraegerModuleGate } from "./traeger-module-not-booked";

function signedIn(permissions: string[]) {
  mockUseSession.mockReturnValue({
    data: {
      user: { id: "1", scope: "org", permissions },
      expires: "2099-01-01T00:00:00Z",
    },
    status: "authenticated",
  });
}

function renderPage(bookedModules: readonly string[] | null) {
  return render(
    <TraegerModuleGate
      booked={{ modules: bookedModules as never, settled: true }}
    >
      <TenantPage title="Abrechnungsläufe">
        <p>Die Läufe des Trägers</p>
      </TenantPage>
    </TraegerModuleGate>,
  );
}

describe("TraegerModuleGate (#6052)", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockPathname.mockReturnValue("/traeger/abrechnung");
    signedIn(["traeger_billing:manage"]);
  });

  it("shows the page of a booked module", () => {
    renderPage(["vertraege", "elternbeitraege"]);
    expect(screen.getByText("Die Läufe des Trägers")).toBeInTheDocument();
  });

  it("keeps every page open while the booked modules load", () => {
    renderPage(null);
    expect(screen.getByText("Die Läufe des Trägers")).toBeInTheDocument();
  });

  it("explains a page whose module no school booked, and who acts next", () => {
    renderPage(["vertraege"]);
    expect(
      screen.getByRole("heading", { name: "Abrechnungsläufe" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Elternbeiträge und Abrechnung ist nicht gebucht"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Diese Seite gehört zum moto-Modul „Elternbeiträge und Abrechnung“. Dein Träger nutzt es nicht. Wenn du es brauchst, sprich mit der Leitung deines Träger-Büros.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Die Läufe des Trägers")).toBeNull();
    // Only who leads the office gets the way to the list of modules.
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("leads who leads the office to the booked modules", () => {
    signedIn(["traeger_billing:manage", "traeger_accounts:manage"]);
    renderPage([]);
    expect(
      screen.getByText(
        "Diese Seite gehört zum moto-Modul „Elternbeiträge und Abrechnung“. Keine Schule deines Trägers hat es gebucht. Für eine Buchung wende dich an das moto-Team.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Gebuchte moto-Module ansehen" }),
    ).toHaveAttribute("href", "/traeger/einstellungen/module");
  });

  it("leaves pages of moto Basis alone", () => {
    mockPathname.mockReturnValue("/traeger/schliesstage");
    renderPage([]);
    expect(screen.getByText("Die Läufe des Trägers")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
