import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CareRule, CareRuleSet } from "~/lib/traeger-care-reductions-api";
import { CareRulesCard } from "./care-rules-card";

const rule: CareRule = {
  version: "v1",
  id: "7",
  kind: "sibling",
  name: "Geschwister",
  validFrom: "2026-09-01",
  validUntil: null,
  schoolIds: ["11"],
  careOfferingIds: [],
  countSchoolIds: ["11", "12"],
  siblingFromChild: 2,
  discountBasisPoints: 5000,
  discountCents: null,
  priceCents: null,
  capCents: null,
  countsFamilyChildren: false,
};

function renderCard(shown: CareRule) {
  const data: CareRuleSet = {
    rules: [shown],
    schools: [
      { id: "11", name: "Schule" },
      { id: "12", name: "Nachbarschule" },
    ],
    modules: [],
  };
  render(
    <CareRulesCard
      kind="sibling"
      data={data}
      currentMonth="2026-09-01"
      onCreate={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
}

describe("CareRulesCard", () => {
  // #7863: the rule's own schools always count, so the line names only
  // the schools the rule counts with them.
  it("names only the other schools a sibling rule counts", () => {
    renderCard(rule);
    expect(
      screen.getByText(/Geschwister zählen auch an: Nachbarschule$/),
    ).toBeInTheDocument();
  });

  it("says that a rule without other schools counts only its own", () => {
    renderCard({ ...rule, countSchoolIds: ["11"] });
    expect(
      screen.getByText(/Geschwister zählen nur an diesen Schulen$/),
    ).toBeInTheDocument();
  });
});
