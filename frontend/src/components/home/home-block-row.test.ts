import { describe, expect, it } from "vitest";

import { openUntil } from "./home-block-row";

describe("openUntil (#8134)", () => {
  it("hält einen laufenden Block offen und schließt einen beendeten", () => {
    expect(openUntil({ status: "planned", endTime: "09:00" })).toBe("09:00");
    // Läuft laut Server noch, obwohl seine Zeit um ist.
    expect(openUntil({ status: "active", endTime: "09:00" }) > "23:59").toBe(
      true,
    );
    // Vorzeitig beendet, obwohl seine Zeit noch läuft.
    expect(openUntil({ status: "completed", endTime: "09:00" }) > "00:01").toBe(
      false,
    );
    expect(openUntil({ status: "cancelled", endTime: "09:00" })).toBe("09:00");
  });
});
