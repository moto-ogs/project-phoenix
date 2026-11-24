import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import type { WorkSessionEdit } from "~/lib/time-tracking-helpers";
import { usePhoneViewport } from "~/test/helpers/viewport";

import { EditHistoryAccordion } from "./edit-history-accordion";

function edit(overrides: Partial<WorkSessionEdit>): WorkSessionEdit {
  return {
    id: "1",
    sessionId: "42",
    staffId: "7",
    editedBy: "3",
    fieldName: "check_in_time",
    oldValue: "2026-10-20T06:00:00Z",
    newValue: "2026-10-20T05:30:00Z",
    notes: "Zeitkorrektur",
    createdAt: "2026-10-20T15:00:00Z",
    editorName: "Anna Müller",
    isSelfEdit: false,
    ...overrides,
  };
}

// The phone stacks the same table rows as cards (#7915): every value of the
// desktop columns stands on a card, without a second list.
describe("EditHistoryAccordion on a phone (#7915)", () => {
  usePhoneViewport();

  it("shows every change of a save with its date, author and reason", () => {
    render(
      <EditHistoryAccordion
        isLoading={false}
        edits={[
          edit({ id: "1" }),
          edit({
            id: "2",
            fieldName: "break_minutes",
            oldValue: "30",
            newValue: "45",
          }),
          edit({
            id: "3",
            fieldName: "check_out_time",
            oldValue: "2026-10-20T14:00:00Z",
            newValue: "2026-10-20T15:00:00Z",
            notes: null,
            createdAt: "2026-10-21T08:00:00Z",
            editorName: "",
            isSelfEdit: true,
          }),
        ]}
      />,
    );

    const list = screen.getByTestId("data-table-stacked");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const [first, second, third] = within(list).getAllByRole("listitem");

    const firstCard = within(first!);
    expect(firstCard.getByText("Start")).toBeInTheDocument();
    expect(firstCard.getByText("08:00")).toBeInTheDocument();
    expect(firstCard.getByText("07:30")).toBeInTheDocument();
    expect(firstCard.getByText("20.10.2026, 17:00")).toBeInTheDocument();
    expect(firstCard.getByText("Anna Müller (Admin)")).toBeInTheDocument();
    expect(firstCard.getByText(/Zeitkorrektur/)).toBeInTheDocument();

    // The second change of the same save names only what changed.
    const secondCard = within(second!);
    expect(secondCard.getByText("Pause")).toBeInTheDocument();
    expect(secondCard.getByText("30 min")).toBeInTheDocument();
    expect(secondCard.getByText("45 min")).toBeInTheDocument();
    expect(
      secondCard.queryByText("Anna Müller (Admin)"),
    ).not.toBeInTheDocument();

    const thirdCard = within(third!);
    expect(thirdCard.getByText("Ende")).toBeInTheDocument();
    expect(thirdCard.getByText("16:00")).toBeInTheDocument();
    expect(thirdCard.getByText("17:00")).toBeInTheDocument();
    expect(thirdCard.getByText("21.10.2026, 10:00")).toBeInTheDocument();
    expect(thirdCard.getByText("Selbst")).toBeInTheDocument();
  });
});
