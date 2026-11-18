import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CareUncountedContract } from "~/lib/traeger-care-billing-api";
import { CareUncountedCard } from "./care-uncounted-card";

vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path.replace(/^\/traeger/, "") || "/",
}));

const contract = (
  id: number,
  status: CareUncountedContract["status"] = "missing",
): CareUncountedContract => ({
  contractId: String(id),
  schoolName: "OGS Birkenfeld",
  childFirstName: `Kind ${id}`,
  childLastName: "Beispiel",
  status,
});

describe("CareUncountedCard", () => {
  it("names each child with the reason and leads to the numbers", () => {
    render(
      <CareUncountedCard
        families={2}
        contracts={[contract(1), contract(2, "expired")]}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Kinderzahl der Familie fehlt" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 Familien offen")).toBeInTheDocument();
    expect(screen.getByText("Kind 1 Beispiel")).toBeInTheDocument();
    expect(screen.getByText("Keine Angabe")).toBeInTheDocument();
    expect(screen.getByText("Abgelaufen")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Kinderzahl prüfen" }),
    ).toHaveAttribute("href", "/abrechnung/kinderzahl");
  });

  it("folds a long list and shows nothing without an open family", () => {
    const { rerender } = render(
      <CareUncountedCard
        families={7}
        contracts={[1, 2, 3, 4, 5, 6, 7].map((id) => contract(id))}
      />,
    );
    expect(screen.getByText("Kind 5 Beispiel")).toBeInTheDocument();
    expect(screen.queryByText("Kind 6 Beispiel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /2 weitere anzeigen/ }));
    expect(screen.getByText("Kind 7 Beispiel")).toBeInTheDocument();

    rerender(<CareUncountedCard families={0} contracts={[]} />);
    // Anker: the card is gone, the test container still renders.
    expect(
      screen.queryByRole("heading", { name: "Kinderzahl der Familie fehlt" }),
    ).not.toBeInTheDocument();
  });
});
