import { describe, expect, it } from "vitest";
import { formatConclusion, knownConclusionAt } from "./care-contract-format";

describe("formatConclusion", () => {
  it("names the day and the way of a taken-over contract, never a time", () => {
    expect(
      formatConclusion({
        method: "einfach_elektronisch",
        at: "2026-03-12T09:41:00Z",
        takenOver: true,
      }),
    ).toBe("Am 12.03.2026, online im vorherigen Programm");
    expect(
      formatConclusion({
        method: "papier",
        at: "2026-03-11T23:00:00Z",
        takenOver: true,
      }),
    ).toBe("Am 12.03.2026, auf Papier");
  });

  it("says that the day of a taken-over contract is unknown", () => {
    expect(
      formatConclusion({
        method: "papier",
        at: "2026-08-01T00:00:00Z",
        takenOver: true,
        dateUnknown: true,
      }),
    ).toBe("Abschlussdatum unbekannt, auf Papier");
    expect(
      formatConclusion({
        method: "einfach_elektronisch",
        at: "2026-08-01T00:00:00Z",
        takenOver: true,
        dateUnknown: true,
      }),
    ).toBe("Abschlussdatum unbekannt, online im vorherigen Programm");
  });

  it("keeps the time of a contract concluded in moto", () => {
    expect(
      formatConclusion({
        method: "einfach_elektronisch",
        at: "2026-11-06T15:12:00Z",
        takenOver: false,
      }),
    ).toBe("Am 06.11.2026 um 16:12 Uhr, mit der Unterschrift der Eltern");
  });
});

describe("knownConclusionAt", () => {
  it("gives no instant for an unknown day", () => {
    expect(knownConclusionAt(null)).toBeNull();
    expect(
      knownConclusionAt({
        method: "papier",
        at: "2026-08-01T00:00:00Z",
        takenOver: true,
        dateUnknown: true,
      }),
    ).toBeNull();
    expect(
      knownConclusionAt({ method: "papier", at: "2026-03-11T23:00:00Z" }),
    ).toBe("2026-03-11T23:00:00Z");
  });
});
