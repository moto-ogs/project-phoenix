import { describe, expect, it, vi } from "vitest";
import type {
  BillingTerms,
  FamilyBilling,
  ServiceTerms,
} from "~/lib/traeger-billing-terms-api";
import {
  bundleLabel,
  dueDaysLabel,
  dueSourceHint,
  familiesPath,
  familyPaymentFilterOf,
  familyPaymentPath,
  findFamilyBilling,
  invoiceDueDatesText,
  paymentMethodsText,
  recipientKindLabel,
  recipientLine,
  runDueDatesText,
  termsPaymentText,
} from "./billing-payment-format";

vi.mock("~/lib/traeger-url", () => ({ traegerPath: (path: string) => path }));

function family(patch: Partial<FamilyBilling>): FamilyBilling {
  return {
    id: "1",
    familyEmail: "anna@example.org",
    contractId: "",
    recipientKind: "applicant",
    secondFirstName: "",
    secondLastName: "",
    payerFirstName: "",
    payerLastName: "",
    payerEmail: "",
    payerAddress: null,
    paymentMethod: "",
    dueDay: 15,
    debtorNumber: "",
    updatedAt: "2026-09-01T10:00:00Z",
    ...patch,
  };
}

describe("billing payment format", () => {
  it("names the payment term and the invoice a service travels on", () => {
    expect(dueDaysLabel(0)).toBe("Sofort");
    expect(dueDaysLabel(1)).toBe("1 Tag");
    expect(dueDaysLabel(14)).toBe("14 Tage");
    expect(bundleLabel("care", ["care"])).toBe(
      "Auf der Rechnung der Betreuung",
    );
    expect(bundleLabel("", ["care"])).toBe("Eigene Rechnung");
    expect(bundleLabel("", [])).toBe("Immer eigene Rechnung");
    expect(bundleLabel("", [], true)).toBe("Eigene Rechnung");
  });

  it("names both parents and the payer, not the contract party", () => {
    expect(recipientKindLabel("applicant")).toBeNull();
    expect(recipientKindLabel("")).toBeNull();
    expect(recipientKindLabel("both")).toBe("Beide Eltern");
    expect(recipientKindLabel("payer")).toBe("Abweichender Zahler");
    expect(
      recipientLine({
        firstName: "Anna",
        lastName: "Muster",
        kind: "both",
        secondName: "Ben Muster",
      }),
    ).toBe("An Anna Muster und Ben Muster");
    expect(recipientLine({ firstName: "", lastName: "" })).toBe(
      "Ohne Empfänger",
    );
  });

  it("lists the run's due dates in form order and hints a family's own day", () => {
    expect(runDueDatesText([])).toBeNull();
    expect(
      runDueDatesText([
        { paymentMethod: "direct_debit", dueOn: "2026-10-01" },
        { paymentMethod: "transfer", dueOn: "2026-10-15" },
      ]),
    ).toBe("Überweisung am 15.10.2026 · Lastschrift am 01.10.2026");
    expect(
      dueSourceHint({
        method: "transfer",
        dueOn: "2026-10-15",
        dueSource: "family",
      }),
    ).toBe("Zahltag der Familie");
    expect(
      dueSourceHint({
        method: "transfer",
        dueOn: "2026-10-15",
        dueSource: "run",
      }),
    ).toBeNull();
    expect(paymentMethodsText(["direct_debit", "transfer"])).toBe(
      "Überweisung, Lastschrift",
    );
    expect(paymentMethodsText([])).toBeNull();
  });

  it("lists distinct frozen dates, including different dates for one method", () => {
    const transfer = {
      method: "transfer" as const,
      dueOn: "2026-10-15",
      dueSource: "family" as const,
    };
    expect(
      invoiceDueDatesText([
        null,
        transfer,
        transfer,
        { ...transfer, dueOn: "2026-10-01" },
      ]),
    ).toBe("Überweisung am 01.10.2026 · Überweisung am 15.10.2026");
  });

  it("finds a family's deviation by contract, else by its address", () => {
    const byContract = family({ id: "2", contractId: "42" });
    const byEmail = family({ id: "3", familyEmail: "anna@example.org" });
    const payer = family({
      id: "4",
      familyEmail: "carla@example.org",
      recipientKind: "payer",
      payerEmail: "Amt@Example.org",
    });
    const otherFamily = family({
      id: "5",
      familyEmail: "dora@example.org",
      recipientKind: "payer",
      payerEmail: "Amt@Example.org",
    });
    const families = [byEmail, byContract, payer, otherFamily];

    expect(
      findFamilyBilling(families, {
        contractId: "42",
        recipientEmail: "other@example.org",
      })?.id,
    ).toBe("2");
    expect(
      findFamilyBilling(families, {
        contractId: "7",
        recipientEmail: " Anna@Example.org ",
      })?.id,
    ).toBe("3");
    // A payer deviation sends the invoice to the payer's address.
    expect(
      findFamilyBilling(families, {
        contractId: "8",
        recipientEmail: "amt@example.org",
        recipientKind: "payer",
        familyEmail: " Dora@Example.org ",
      })?.id,
    ).toBe("5");
    expect(
      findFamilyBilling(families, {
        contractId: "8",
        recipientEmail: "amt@example.org",
        recipientKind: "payer",
      }),
    ).toBeNull();
    expect(
      findFamilyBilling(families, {
        contractId: "9",
        recipientEmail: "nobody@example.org",
      }),
    ).toBeNull();
  });
});

function terms(...entries: Partial<ServiceTerms>[]): BillingTerms {
  return {
    services: [],
    terms: entries.map((entry) => ({
      service: "care",
      paymentMethod: "transfer",
      dueDays: 14,
      bundleWith: "",
      custom: false,
      updatedAt: null,
      ...entry,
    })),
  };
}

describe("family payment without a run (#7770)", () => {
  it("names one payment method for all services, else each service", () => {
    expect(
      termsPaymentText(
        terms(
          { service: "care", paymentMethod: "transfer" },
          { service: "meal", paymentMethod: "transfer" },
        ),
      ),
    ).toBe("Überweisung für alle Leistungen");
    expect(
      termsPaymentText(
        terms(
          { service: "care", paymentMethod: "direct_debit" },
          { service: "meal", paymentMethod: "transfer" },
          { service: "holiday", paymentMethod: undefined },
        ),
      ),
    ).toBe(
      "Monatsbeitrag Betreuung per Lastschrift, Mittagessen per Überweisung",
    );
    expect(
      termsPaymentText(terms({ service: "care", paymentMethod: undefined })),
    ).toBeNull();
    expect(termsPaymentText(terms())).toBeNull();
  });

  it("builds the payment page's address with its way back", () => {
    expect(familyPaymentPath("42")).toBe(
      "/traeger/abrechnung/familien/zahlung/42",
    );
    expect(familyPaymentPath("42", { contract: true })).toBe(
      "/traeger/abrechnung/familien/zahlung/42?von=vertrag",
    );
    expect(familyPaymentPath("42", { filter: "ohne" })).toBe(
      "/traeger/abrechnung/familien/zahlung/42?zahlung=ohne",
    );
    expect(familyPaymentPath("42", { filter: "" })).toBe(
      "/traeger/abrechnung/familien/zahlung/42",
    );
    expect(familyPaymentPath("4/2?x")).toBe(
      "/traeger/abrechnung/familien/zahlung/4%2F2%3Fx",
    );
  });

  it("keeps the list's payment filter in the address", () => {
    expect(familiesPath()).toBe("/traeger/abrechnung/familien");
    expect(familiesPath("")).toBe("/traeger/abrechnung/familien");
    expect(familiesPath("lastschrift")).toBe(
      "/traeger/abrechnung/familien?zahlung=lastschrift",
    );
    expect(familyPaymentFilterOf("ohne")).toBe("ohne");
    expect(familyPaymentFilterOf("ueberweisung")).toBe("ueberweisung");
    expect(familyPaymentFilterOf("bar")).toBe("");
    expect(familyPaymentFilterOf("")).toBe("");
    expect(familyPaymentFilterOf(null)).toBe("");
    expect(familyPaymentFilterOf(undefined)).toBe("");
  });
});
