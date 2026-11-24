import { describe, expect, it } from "vitest";

import { reloadedModalShift } from "./dienstplan-modal-reload";
import type { StaffShift } from "~/lib/shift-helpers";

const shift = (id: string, originShiftId?: string) =>
  ({ id, originShiftId, version: `v-${id}` }) as unknown as StaffShift;

describe("reloadedModalShift (ADR 0311)", () => {
  it("hands the stored shift with its covers to the open modal", () => {
    expect(
      reloadedModalShift("5", [shift("5"), shift("6", "5"), shift("7")]),
    ).toEqual({
      kind: "stored",
      shift: shift("5"),
      replacements: [shift("6", "5")],
    });
  });

  it("reports a shift gone from the reloaded week", () => {
    expect(reloadedModalShift("5", [shift("7")])).toEqual({ kind: "gone" });
  });
});
