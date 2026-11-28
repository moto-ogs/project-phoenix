import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  InvoiceAccountEmail,
  PartyInvoiceEmail,
  differentEmail,
} from "./account-email-note";

describe("account email notes (#8215)", () => {
  it("names where the invoices go when the account's address differs", () => {
    render(
      <PartyInvoiceEmail
        email="eva@example.org"
        accountEmail="eva.neu@example.org"
      />,
    );
    expect(screen.getByText(/Rechnungen gehen an/)).toHaveTextContent(
      "Rechnungen gehen an eva.neu@example.org. Diese Adresse steht im Elternkonto. Der Vertrag bleibt, wie er unterschrieben wurde.",
    );
  });

  it("says at the invoice that it goes to the account and names the contract's address", () => {
    render(
      <InvoiceAccountEmail
        email="eva.neu@example.org"
        contractEmail="eva@example.org"
      />,
    );
    expect(
      screen.getByText(
        "Per E-Mail an eva.neu@example.org aus dem Elternkonto. Im Vertrag steht eva@example.org.",
      ),
    ).toBeInTheDocument();
  });

  it("shows nothing when both addresses match or one is missing", () => {
    expect(differentEmail("Eva@Example.org ", "eva@example.org")).toBe(false);
    expect(differentEmail("eva@example.org", "")).toBe(false);
    expect(differentEmail("eva@example.org", undefined)).toBe(false);
    expect(differentEmail("eva@example.org", "eva.neu@example.org")).toBe(true);
    render(
      <>
        <p>Vertrag</p>
        <PartyInvoiceEmail
          email="eva@example.org"
          accountEmail="EVA@example.org"
        />
        <InvoiceAccountEmail email="eva@example.org" contractEmail="" />
      </>,
    );
    expect(screen.getByText("Vertrag")).toBeInTheDocument();
    expect(screen.queryByText(/Elternkonto/)).not.toBeInTheDocument();
  });
});
