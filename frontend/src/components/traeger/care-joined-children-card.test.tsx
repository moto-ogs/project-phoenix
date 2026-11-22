import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CareJoinedChild } from "~/lib/traeger-care-billing-api";
import { CareJoinedChildrenCard } from "./care-joined-children-card";

vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path.replace(/^\/traeger/, "") || "/",
}));

const joined = (id: number): CareJoinedChild => ({
  childFirstName: `Kind ${id}`,
  childLastName: "Beispiel",
  contracts: [
    { contractId: `${id}1`, schoolId: "1", schoolName: "OGS Birkenfeld" },
    { contractId: `${id}2`, schoolId: "2", schoolName: "OGS Ispringen" },
  ],
});

describe("CareJoinedChildrenCard", () => {
  it("names each child with its schools in order and opens both contracts", () => {
    render(<CareJoinedChildrenCard childrenJoined={[joined(1)]} />);
    expect(
      screen.getByRole("heading", { name: "Ein Kind an zwei Schulen" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 Kind")).toBeInTheDocument();
    expect(screen.getByText("Kind 1 Beispiel")).toBeInTheDocument();
    expect(
      screen.getByText("OGS Birkenfeld, dann OGS Ispringen"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Vertrag 1 von Kind 1 Beispiel öffnen: OGS Birkenfeld",
      }),
    ).toHaveAttribute("href", "/vertraege/11");
    expect(
      screen.getByRole("link", {
        name: "Vertrag 2 von Kind 1 Beispiel öffnen: OGS Ispringen",
      }),
    ).toHaveAttribute("href", "/vertraege/12");
  });

  it("folds a long list and shows nothing without a joined child", () => {
    const { rerender } = render(
      <CareJoinedChildrenCard
        childrenJoined={[1, 2, 3, 4, 5, 6].map((id) => joined(id))}
      />,
    );
    expect(screen.getByText("6 Kinder")).toBeInTheDocument();
    expect(screen.getByText("Kind 5 Beispiel")).toBeInTheDocument();
    expect(screen.queryByText("Kind 6 Beispiel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /1 weitere anzeigen/ }));
    expect(screen.getByText("Kind 6 Beispiel")).toBeInTheDocument();

    rerender(<CareJoinedChildrenCard childrenJoined={[]} />);
    // Anker: the card is gone, the test container still renders.
    expect(
      screen.queryByRole("heading", { name: "Ein Kind an zwei Schulen" }),
    ).not.toBeInTheDocument();
  });
});
