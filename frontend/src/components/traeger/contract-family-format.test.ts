import { describe, expect, it } from "vitest";
import type {
  ContractFamilyEvent,
  ContractFamilyMember,
} from "~/lib/traeger-contract-families-api";
import {
  contractFamilies,
  familyEventText,
  familyMatches,
  familyParents,
  proposedLead,
} from "./contract-family-format";

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
    childBirthDate: null,
    partyName: `Katrin ${childLastName}`,
  };
}

describe("contractFamilies", () => {
  it("groups led contracts under their lead, siblings by last name", () => {
    const families = contractFamilies([
      contract("4", "Mila", "Schulz", "3"),
      contract("7", "Ben", "Yilmaz"),
      contract("3", "Finn", "Schulz"),
      contract("5", "Anna", "Becker"),
    ]);
    expect(families.map((family) => family.leadId)).toEqual(["5", "3", "7"]);
    expect(families[1]?.members.map((member) => member.contractId)).toEqual([
      "3",
      "4",
    ]);
  });

  it("lets a contract whose lead is not listed lead itself", () => {
    const families = contractFamilies([contract("4", "Mila", "Schulz", "99")]);
    expect(families).toHaveLength(1);
    expect(families[0]?.leadId).toBe("4");
  });
});

describe("family texts", () => {
  const [schulz] = contractFamilies([
    contract("3", "Finn", "Schulz"),
    contract("4", "Mila", "Schulz", "3"),
  ]);

  it("names the parents once and finds children, parents and numbers", () => {
    expect(schulz && familyParents(schulz)).toBe("Katrin Schulz");
    expect(schulz && familyMatches(schulz, "mila")).toBe(true);
    expect(schulz && familyMatches(schulz, "4")).toBe(true);
    expect(schulz && familyMatches(schulz, "Yilmaz")).toBe(false);
  });

  it("keeps the lead of a family with siblings", () => {
    const [ben] = contractFamilies([contract("7", "Ben", "Yilmaz")]);
    expect(proposedLead(ben && schulz ? [ben, schulz] : [])).toBe("3");
    expect(proposedLead(ben ? [ben] : [])).toBe("7");
  });

  it("says in one sentence what changed", () => {
    const names = new Map([["3", "Finn Schulz"]]);
    const event: ContractFamilyEvent = {
      id: "1",
      action: "join_family",
      contractId: "4",
      familyContractId: "3",
      previousFamilyContractId: "4",
      childFirstName: "Mila",
      childLastName: "Schulz",
      accountId: "8",
      at: "2026-09-09T10:00:00Z",
    };
    expect(familyEventText(event, names)).toBe(
      "Mila Schulz zur Familie von Finn Schulz",
    );
    expect(
      familyEventText(
        {
          ...event,
          action: "leave_family",
          familyContractId: "4",
          previousFamilyContractId: "3",
        },
        names,
      ),
    ).toBe("Mila Schulz aus der Familie von Finn Schulz gelöst");
    expect(
      familyEventText({ ...event, familyContractId: "9" }, new Map()),
    ).toBe("Mila Schulz zur Familie von Vertrag Nr. 9");
  });
});
