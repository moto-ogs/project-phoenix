import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { OwnLeaveAllowance } from "~/lib/contract/time-tracking.generated";
import { OwnAllowancesCard } from "./own-allowances-card";

const regeneration = {
  absence_type_id: "42",
  name: "Regenerationstag",
  entitled_days: 3,
  taken_days: 1,
  reserved_days: 0.5,
  remaining_days: 1.5,
  expires_on: "2027-03-31",
  expired_days: 0,
  carried_in: {
    year: 2025,
    remaining_days: 1,
    expired_days: 0,
    expires_on: "2026-03-31",
  },
} satisfies OwnLeaveAllowance;

describe("OwnAllowancesCard", () => {
  it("shows each Kontingent read-only with who changes the claim", async () => {
    render(<OwnAllowancesCard allowances={[regeneration]} year={2026} />);

    const card = await screen.findByRole("region", {
      name: "Regenerationstag 2026",
    });
    expect(
      screen.getByText(
        "Deine Tage je Abwesenheitsart. Den Anspruch trägt deine Leitung ein.",
      ),
    ).toBeInTheDocument();
    expect(within(card).getByText("Anspruch")).toBeInTheDocument();
    expect(within(card).getByText("3 Tage")).toBeInTheDocument();
    expect(within(card).getByText("1 Tag")).toBeInTheDocument();
    expect(within(card).getByText("0,5 Tage")).toBeInTheDocument();
    expect(within(card).getByText("1,5 Tage")).toBeInTheDocument();
    expect(
      within(card).getByText(
        "Dazu noch 1 Tag aus 2025, nutzbar bis 31.03.2026. Diese gehen zuerst ab.",
      ),
    ).toBeInTheDocument();
    // Anker: die Karte ist geladen; nur lesen, also kein Knopf darin.
    expect(within(card).getByText("Übrig")).toBeInTheDocument();
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
  });

  it("stays away when the school has no type with an allowance", () => {
    const { container } = render(
      <OwnAllowancesCard allowances={[]} year={2026} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
