import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/components/ui/date-picker", async () =>
  (await import("~/test/mocks/date-picker")).datePickerModuleMock(),
);

vi.mock("~/lib/logger", () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

import { OpeningChangeModal } from "./opening-change-modal";

describe("OpeningChangeModal", () => {
  it("beschränkt neue Tage auf den Bereich der Liste", () => {
    render(
      <OpeningChangeModal
        isOpen
        onClose={vi.fn()}
        onSaved={vi.fn()}
        minDate="2026-08-10"
        maxDate="2027-09-09"
      />,
    );

    const start = screen.getByLabelText("Von");
    const end = screen.getByLabelText("Bis");
    expect(start).toHaveAttribute("min", "2026-08-10");
    expect(start).toHaveAttribute("max", "2027-09-09");
    expect(end).toHaveAttribute("min", "2026-08-10");
    expect(end).toHaveAttribute("max", "2027-09-09");

    fireEvent.change(start, { target: { value: "2026-11-20" } });
    expect(end).toHaveAttribute("min", "2026-11-20");
    expect(end).toHaveAttribute("max", "2027-09-09");
  });
});
