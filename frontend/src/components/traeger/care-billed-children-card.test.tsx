import { fireEvent, render, screen, within } from "@testing-library/react";
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
        "Für dieses Kind ist der Monat schon abgerechnet. Der Lauf stellt keine zweite Rechnung aus. Stimmt das, musst du nichts tun. Ist eine Rechnung falsch, storniere sie. Danach rechnet dieser Lauf das Kind ab.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Kind 1 Beispiel")).toBeInTheDocument();
    expect(
      screen.getByText("Rechnung MB-0001 · OGS Ispringen"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Rechnung öffnen: MB-0001, Kind 1 Beispiel",
      }),
    ).toHaveAttribute("href", "/abrechnung/monatsbeitraege/31/rechnung/12");
    expect(
      screen.getByRole("link", {
        name: "Vertrag · OGS Birkenfeld: Kind 1 Beispiel",
      }),
    ).toHaveAttribute("href", "/vertraege/11");
  });

  // An invoice with only the Mensa leaves the care unbilled: the card of
  // such a child tells to cancel it and never that nothing is to do.
  it("tells to cancel an invoice with only the Mensa, in a card of its own", () => {
    const { rerender } = render(
      <CareBilledChildrenCard
        childrenBilled={[billed(1), billed(2, { reason: "meal_only_invoice" })]}
      />,
    );
    const heading = screen.getByRole("heading", {
      name: "Betreuung noch nicht abgerechnet – Rechnung nur mit Mensa",
    });
    const card = heading.closest("section");
    if (!card) throw new Error("the Mensa card without its section");
    expect(
      within(card).getByText(
        "Die Rechnung dieses Kindes enthält nur die Mensa. Die Betreuung ist noch nicht abgerechnet. Storniere die Rechnung. Danach rechnet dieser Lauf das Kind neu und zeigt, was noch offen ist.",
      ),
    ).toBeInTheDocument();
    expect(within(card).getByText("Kind 2 Beispiel")).toBeInTheDocument();
    expect(
      within(card).getByText("Rechnung MB-0002 · OGS Ispringen"),
    ).toBeInTheDocument();
    // Anker: the card of the Mensa invoice renders with its own text.
    expect(within(card).queryByText(/musst du nichts tun/)).toBeNull();
    expect(within(card).queryByText("Kind 1 Beispiel")).toBeNull();
    // The child whose month is billed keeps its own card.
    expect(
      screen.getByRole("heading", {
        name: "Kind hat schon eine Rechnung – bitte prüfen",
      }),
    ).toBeInTheDocument();

    rerender(
      <CareBilledChildrenCard
        childrenBilled={[
          billed(2, { reason: "meal_only_invoice" }),
          billed(3, { reason: "meal_only_invoice" }),
        ]}
        released
      />,
    );
    expect(
      screen.getByText(
        "Die Rechnungen dieser Kinder enthalten nur die Mensa. Die Betreuung ist noch nicht abgerechnet. Storniere die Rechnungen. Danach rechnet ein neuer Monatslauf die Kinder neu und zeigt, was noch offen ist.",
      ),
    ).toBeInTheDocument();
    // Anker: only the Mensa card is left, nothing says the month is billed.
    expect(
      screen.queryByRole("heading", {
        name: "Nicht abgerechnet – Kind hatte schon eine Rechnung",
      }),
    ).toBeNull();
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
        /Ist ein Jahresbescheid falsch, ändere ihn mit einem neuen Jahreslauf\. Danach rechnet dieser Lauf das Kind ab\.$/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Jahresbescheid öffnen: JB-0003, Kind 3 Beispiel",
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
        "Für dieses Kind war der Monat schon abgerechnet. Der Lauf hat keine zweite Rechnung ausgestellt. Stimmt das, musst du nichts tun. Ist eine Rechnung falsch, storniere sie. Danach rechnet ein neuer Monatslauf das Kind ab.",
      ),
    ).toBeInTheDocument();

    rerender(<CareBilledChildrenCard childrenBilled={[billed(1)]} yearly />);
    expect(
      screen.getByText(
        "Für dieses Kind ist ein Monat des Jahres schon abgerechnet. Der Jahreslauf ändert diesen Monat im Bescheid nicht. Stimmt das, musst du nichts tun. Ist eine Rechnung falsch, storniere sie. Danach nimmt diese Vorschau den Monat auf.",
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
      screen.queryByRole("link", { name: /MB-0004/ }),
    ).not.toBeInTheDocument();
  });

  it("folds a long list and shows nothing without a held child", () => {
    const { rerender } = render(
      <CareBilledChildrenCard
        childrenBilled={[1, 2, 3, 4, 5, 6].map((id) => billed(id))}
      />,
    );
    expect(screen.getByText("6 Kinder")).toBeInTheDocument();
    expect(
      screen.getByText(
        /^Für diese Kinder ist der Monat schon abgerechnet\..* Danach rechnet dieser Lauf die Kinder ab\.$/,
      ),
    ).toBeInTheDocument();
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
