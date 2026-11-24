import { describe, expect, it } from "vitest";
import type { FamilyChildren } from "~/lib/traeger-family-children-api";
import {
  checkReason,
  familyAddress,
  familyKey,
  familyName,
} from "./family-children-format";

const family = (
  status: FamilyChildren["status"],
  validFrom: string,
  validUntil: string | null,
): FamilyChildren => ({
  version: "v1",
  contractId: "31",
  recipientFirstName: "Eva",
  recipientLastName: "Beispiel",
  recipientEmail: "eva@example.org",
  children: [],
  count: {
    id: "1",
    contractId: "31",
    statedChildren: null,
    statedAt: null,
    confirmedChildren: 3,
    validFrom,
    validUntil,
    confirmedAt: "2026-09-01T08:00:00Z",
  },
  status,
});

describe("checkReason", () => {
  it("names the end of the current confirmation", () => {
    expect(
      checkReason(family("expired", "2026-01-01", "2026-08-31"), "2026-09-09"),
    ).toBe("Die Kinderzahl galt bis 31.08.2026. Bitte neu prüfen.");
    expect(
      checkReason(family("expiring", "2026-01-01", "2026-09-30"), "2026-09-09"),
    ).toBe("Die Kinderzahl gilt nur bis 30.09.2026.");
  });

  it("names the start of a later confirmation, never its open end", () => {
    expect(
      checkReason(family("expired", "2027-01-01", null), "2026-12-10"),
    ).toBe(
      "Die bisherige Kinderzahl ist abgelaufen. Die neue gilt erst ab 01.01.2027.",
    );
    expect(
      checkReason(family("expiring", "2027-01-01", null), "2026-11-10"),
    ).toBe(
      "Die bisherige Kinderzahl läuft bald ab. Die neue gilt erst ab 01.01.2027.",
    );
  });
});

describe("a family without a mail address (#7356)", () => {
  const imported: FamilyChildren = {
    version: "v1",
    contractId: "77",
    recipientFirstName: "",
    recipientLastName: "",
    recipientEmail: "",
    children: [
      {
        contractId: "77",
        schoolName: "OGS Birkenfeld",
        childFirstName: "Mia",
        childLastName: "Beispiel",
      },
    ],
    count: null,
    status: "missing",
  };

  it("is named by its child and told apart by its contract", () => {
    expect(familyName(imported)).toBe("Familie von Mia Beispiel");
    expect(familyAddress(imported)).toBe("Vertrag Nr. 77 · ohne E-Mail");
    expect(familyKey(imported)).toBe("contract:77");
  });

  it("keeps the name of its recipient when the contract has one", () => {
    const named = { ...imported, recipientLastName: "Zeller" };
    expect(familyName(named)).toBe("Zeller");
    expect(familyAddress(named)).toBe("Vertrag Nr. 77 · ohne E-Mail");
  });

  it("names a family with an address by it", () => {
    const family = { ...imported, recipientEmail: "eva@example.org" };
    expect(familyName(family)).toBe("eva@example.org");
    expect(familyAddress(family)).toBe("eva@example.org");
    expect(familyKey(family)).toBe("eva@example.org");
  });

  it("says why different numbers of its contracts need a decision", () => {
    expect(
      checkReason({ ...imported, status: "differing" }, "2026-09-09"),
    ).toBe(
      "Die Verträge der Familie nennen verschiedene Kinderzahlen. Bis du eine bestätigst, zählen nur die Kinder mit Vertrag.",
    );
  });
});
