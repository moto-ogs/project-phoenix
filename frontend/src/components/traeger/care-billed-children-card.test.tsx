import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CareBilledChild } from "~/lib/traeger-care-billing-api";
import { CareBilledChildrenCard } from "./care-billed-children-card";

vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path.replace(/^\/traeger/, "") || "/",
}));

const billed = (
  id: number,
  overrides: Partial<CareBilledChild> = {},
): CareBilledChild => ({
  childFirstName: `Kind ${id}`,
  childLastName: "Beispiel",
  reason: "already_billed",
  contracts: [
    { contractId: `${id}1`, schoolId: "1", schoolName: "OGS Birkenfeld" },
  ],
  invoices: [
    {
      source: "care_run",
      runId: "31",
      contractId: `${id}2`,
      schoolName: "OGS Ispringen",
      number: `MB-000${id}`,
      documentKind: "invoice",
    },
  ],
  ...overrides,
});

describe("CareBilledChildrenCard", () => {
  it("names the child with the invoice in its way and opens invoice and contract", () => {
    render(<CareBilledChildrenCard childrenBilled={[billed(1)]} />);
    expect(
      screen.getByRole("heading", {
        name: "Kind hat schon eine Rechnung – bitte prüfen",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 Kind")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Für diese Kinder gibt es in diesem Monat schon eine Rechnung. Der Lauf stellt für sie keine weitere aus. Stimmt die Rechnung, musst du nichts tun. Ist sie falsch, storniere sie. Danach rechnet ein neuer Monatslauf das Kind ab.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Kind 1 Beispiel")).toBeInTheDocument();
    expect(
      screen.getByText("Rechnung MB-0001 · OGS Ispringen"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Rechnung MB-0001 von Kind 1 Beispiel öffnen",
      }),
    ).toHaveAttribute("href", "/abrechnung/monatsbeitraege/31/rechnung/12");
    expect(
      screen.getByRole("link", {
        name: "Vertrag von Kind 1 Beispiel öffnen: OGS Birkenfeld",
      }),
    ).toHaveAttribute("href", "/vertraege/11");
  });

  it("says that an invoice with only the Mensa lacks the care", () => {
    render(
      <CareBilledChildrenCard
        childrenBilled={[billed(2, { reason: "meal_only_invoice" })]}
      />,
    );
    expect(
      screen.getByText(
        "Rechnung MB-0002 · OGS Ispringen · nur Mensa, die Betreuung fehlt",
      ),
    ).toBeInTheDocument();
  });

  it("opens a Jahresbescheid in its own run and says how to change it", () => {
    render(
      <CareBilledChildrenCard
        childrenBilled={[
          billed(3, {
            invoices: [
              {
                source: "care_notice_run",
                runId: "9",
                contractId: "32",
                schoolName: "OGS Ispringen",
                number: "JB-0003",
                documentKind: "fee_notice",
              },
            ],
          }),
        ]}
      />,
    );
    expect(
      screen.getByText("Jahresbescheid JB-0003 · OGS Ispringen"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Einen Jahresbescheid änderst du mit einem neuen Jahreslauf\.$/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Jahresbescheid JB-0003 von Kind 3 Beispiel öffnen",
      }),
    ).toHaveAttribute("href", "/abrechnung/jahresbescheide/9/bescheid/32");
  });

  it("speaks of what the release did in a released run and of the month in a Jahreslauf", () => {
    const { rerender } = render(
      <CareBilledChildrenCard childrenBilled={[billed(1)]} released />,
    );
    expect(
      screen.getByRole("heading", {
        name: "Nicht abgerechnet – Kind hatte schon eine Rechnung",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Für diese Kinder gab es in diesem Monat schon eine Rechnung. Der Lauf hat für sie keine weitere ausgestellt. Stimmt die Rechnung, musst du nichts tun. Ist sie falsch, storniere sie. Danach rechnet ein neuer Monatslauf das Kind ab.",
      ),
    ).toBeInTheDocument();

    rerender(<CareBilledChildrenCard childrenBilled={[billed(1)]} yearly />);
    expect(
      screen.getByText(
        "Für diese Kinder gibt es in einem Monat des Jahres schon eine Rechnung. Der Jahreslauf nimmt diesen Monat nicht in ihren Bescheid. Stimmt die Rechnung, musst du nichts tun. Ist sie falsch, storniere sie. Danach nimmt ein neuer Jahreslauf den Monat auf.",
      ),
    ).toBeInTheDocument();
  });

  it("names a document without its run but offers no link to it", () => {
    render(
      <CareBilledChildrenCard
        childrenBilled={[
          billed(4, {
            invoices: [
              {
                source: "care_run",
                runId: "",
                contractId: "42",
                schoolName: "OGS Ispringen",
                number: "MB-0004",
                documentKind: "invoice",
              },
            ],
          }),
        ]}
      />,
    );
    expect(
      screen.getByText("Rechnung MB-0004 · OGS Ispringen"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Rechnung MB-0004/ }),
    ).not.toBeInTheDocument();
  });

  it("folds a long list and shows nothing without a held child", () => {
    const { rerender } = render(
      <CareBilledChildrenCard
        childrenBilled={[1, 2, 3, 4, 5, 6].map((id) => billed(id))}
      />,
    );
    expect(screen.getByText("6 Kinder")).toBeInTheDocument();
    expect(screen.getByText("Kind 5 Beispiel")).toBeInTheDocument();
    expect(screen.queryByText("Kind 6 Beispiel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /1 weitere anzeigen/ }));
    expect(screen.getByText("Kind 6 Beispiel")).toBeInTheDocument();

    rerender(<CareBilledChildrenCard childrenBilled={[]} />);
    // Anker: the card is gone, the test container still renders.
    expect(
      screen.queryByRole("heading", {
        name: "Kind hat schon eine Rechnung – bitte prüfen",
      }),
    ).not.toBeInTheDocument();
  });
});
